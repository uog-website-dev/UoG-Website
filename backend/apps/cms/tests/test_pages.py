"""Page routing: computed paths, hierarchy rules, uniqueness and serving."""
import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError

from apps.cms.models import MAX_PAGE_DEPTH, Page, Visibility
from apps.cms.selectors.pages import public_pages, published_page
from apps.cms.services.pages import change_route, create_page
from apps.cms.services.workflow import transition_content
from apps.sites.configuration import default_configuration
from apps.sites.models import Site

pytestmark = pytest.mark.django_db


def _bilingual_site(unit):
    """A Site offering both platform languages, for locale-scoped rules."""
    configuration = default_configuration("en-us")
    configuration["language"]["enabled"] = ["en-us", "am"]
    return Site.objects.create(
        organization_unit=unit, code="BILINGUAL", name="Bilingual",
        configuration=configuration,
    )


def test_paths_are_computed_from_the_slug_chain(sites):
    site, _ = sites
    about = create_page(site=site, title="About", slug="About Us")
    people = create_page(site=site, title="People", slug="People", parent=about)
    team = create_page(site=site, title="Team", slug="team", parent=people)
    assert about.slug == "about-us"  # normalized before validation
    assert about.path == "/about-us"
    assert people.path == "/about-us/people"
    assert team.path == "/about-us/people/team"


def test_duplicate_full_routes_are_rejected_per_site_and_locale(sites):
    site, other = sites
    root = create_page(site=site, title="News", slug="news")
    duplicate = Page(site=site, title="News again", slug="news")
    with pytest.raises(ValidationError) as error:
        duplicate.save()
    assert "path" in error.value.error_dict
    # Same slug under a different parent is a different full route.
    section = create_page(site=site, title="Section", slug="section")
    create_page(site=site, title="News in section", slug="news", parent=section)
    # The database backstops the rule for writers that skip the domain.
    second = create_page(site=site, title="Other", slug="other")
    with pytest.raises(IntegrityError), transaction.atomic():
        Page.objects.filter(pk=second.pk).update(path="/news")
    second.refresh_from_db()
    assert second.path == "/other"
    assert root.path == "/news"


def test_the_same_route_is_free_in_another_site_or_locale(sites):
    site, other = sites
    mine = create_page(site=site, title="About", slug="about")
    theirs = create_page(site=other, title="About", slug="about")
    assert mine.path == theirs.path == "/about"
    bilingual = _bilingual_site(site.organization_unit)
    english = create_page(site=bilingual, title="About", slug="about", locale="en-us")
    amharic = create_page(site=bilingual, title="About", slug="about", locale="am")
    assert english.path == amharic.path == "/about"
    assert english.locale != amharic.locale


def test_parents_must_share_site_and_locale(sites):
    site, other = sites
    foreign = create_page(site=other, title="Other", slug="other")
    page = Page(site=site, title="Child", slug="child", parent=foreign)
    with pytest.raises(ValidationError) as error:
        page.save()
    assert "parent" in error.value.error_dict
    bilingual = _bilingual_site(site.organization_unit)
    parent_en = create_page(site=bilingual, title="EN", slug="en-root", locale="en-us")
    child_am = Page(
        site=bilingual, title="AM", slug="am-child", locale="am", parent=parent_en,
    )
    with pytest.raises(ValidationError) as error:
        child_am.save()
    assert "parent" in error.value.error_dict


def test_hierarchy_cycles_are_rejected(sites):
    site, _ = sites
    root = create_page(site=site, title="Root", slug="root")
    child = create_page(site=site, title="Child", slug="child", parent=root)
    grandchild = create_page(site=site, title="Grand", slug="grand", parent=child)
    # Self-parenting.
    fresh = Page.objects.get(pk=root.pk)
    fresh.parent = fresh
    with pytest.raises(ValidationError) as error:
        fresh.save()
    assert "parent" in error.value.error_dict
    # Reparenting an ancestor below its own descendant.
    fresh = Page.objects.get(pk=root.pk)
    fresh.parent = grandchild
    with pytest.raises(ValidationError) as error:
        fresh.save()
    assert "ancestor" in str(error.value)
    # The database refuses the same move for writers that bypass the domain.
    with pytest.raises(IntegrityError), transaction.atomic():
        Page.objects.filter(pk=root.pk).update(parent_id=grandchild.pk)
    root.refresh_from_db()
    assert root.parent_id is None


def test_hierarchy_depth_is_capped(sites):
    site, _ = sites
    parent = None
    for level in range(1, MAX_PAGE_DEPTH + 2):
        try:
            parent = create_page(
                site=site, title=f"Level {level}", slug=f"level-{level}",
                parent=parent,
            )
        except ValidationError as error:
            assert "parent" in error.error_dict
            assert level == MAX_PAGE_DEPTH + 1
            break
    else:
        pytest.fail("the hierarchy depth cap never triggered")


def test_pages_protect_their_parent_and_site(sites):
    site, _ = sites
    parent = create_page(site=site, title="Parent", slug="parent")
    create_page(site=site, title="Child", slug="child", parent=parent)
    with pytest.raises(ProtectedError):
        Page.objects.filter(pk=parent.pk).delete()
    with pytest.raises(ProtectedError):
        Site.objects.filter(pk=site.pk).delete()
    assert Page.objects.filter(pk=parent.pk).exists()


def test_page_language_is_fixed_after_creation(sites):
    site, _ = sites
    bilingual = _bilingual_site(site.organization_unit)
    page = create_page(site=bilingual, title="EN", slug="en-page", locale="en-us")
    page.locale = "am"  # enabled for the Site, but not for this row
    with pytest.raises(ValidationError) as error:
        page.save()
    assert "fixed after creation" in str(error.value)
    page.refresh_from_db()
    assert page.locale == "en-us"


def test_seo_visibility_and_layout_are_validated(sites):
    site, _ = sites
    with pytest.raises(ValidationError) as error:
        create_page(site=site, title="X", slug="seo-list", seo=["not", "an", "object"])
    assert "seo" in error.value.error_dict
    with pytest.raises(ValidationError) as error:
        create_page(site=site, title="X", slug="seo-unknown", seo={"keywords": "x"})
    assert "seo" in error.value.error_dict
    with pytest.raises(ValidationError):
        create_page(site=site, title="X", slug="seo-number", seo={"meta_title": 120})
    with pytest.raises(ValidationError):
        create_page(
            site=site, title="X", slug="seo-long",
            seo={"meta_title": "x" * 121},
        )
    accepted = create_page(
        site=site, title="Welcome", slug="welcome",
        seo={"meta_title": "Welcome", "meta_description": "The university portal"},
    )
    assert accepted.seo["meta_title"] == "Welcome"
    with pytest.raises(ValidationError) as error:
        create_page(site=site, title="X", slug="bad-visibility", visibility="SECRET")
    assert "visibility" in error.value.error_dict
    laid_out = create_page(site=site, title="L", slug="landing", layout=" landing ")
    assert laid_out.layout == "LANDING"
    with pytest.raises(ValidationError):
        create_page(site=site, title="X", slug="bad-layout", layout="bad layout!")
    # The database enforces the same two shapes for raw writers.
    with pytest.raises(IntegrityError), transaction.atomic():
        Page.objects.filter(pk=accepted.pk).update(seo=["raw"])
    with pytest.raises(IntegrityError), transaction.atomic():
        Page.objects.filter(pk=accepted.pk).update(visibility="SECRET")


def test_draft_and_hidden_pages_are_not_publicly_served(sites):
    site, _ = sites
    draft = create_page(site=site, title="Draft", slug="draft")
    assert published_page(site.pk, draft.locale, "/draft") is None
    _publish_for_test(draft)
    assert published_page(site.pk, draft.locale, "/draft").pk == draft.pk
    hidden = create_page(
        site=site, title="Hidden", slug="hidden", visibility=Visibility.HIDDEN,
    )
    _publish_for_test(hidden)
    assert published_page(site.pk, hidden.locale, "/hidden") is None
    unlisted = create_page(
        site=site, title="Unlisted", slug="unlisted",
        visibility=Visibility.UNLISTED,
    )
    _publish_for_test(unlisted)
    # Served by its direct route, but never listed.
    assert published_page(site.pk, unlisted.locale, "/unlisted").pk == unlisted.pk
    listed = [page.pk for page in public_pages(site.pk, draft.locale)]
    assert draft.pk in listed
    assert unlisted.pk not in listed
    assert hidden.pk not in listed


def test_pages_never_leak_between_sites(sites):
    site, other = sites
    mine = create_page(site=site, title="Mine", slug="shared-slug")
    theirs = create_page(site=other, title="Theirs", slug="shared-slug")
    assert mine.pk != theirs.pk
    assert list(Page.objects.filter(site=site).values_list("pk", flat=True)) == [mine.pk]
    assert list(Page.objects.filter(site=other).values_list("pk", flat=True)) == [theirs.pk]
    # A route belongs to exactly one Site's URL space.
    _publish_for_test(theirs)
    assert published_page(other.pk, theirs.locale, "/shared-slug").pk == theirs.pk
    assert published_page(site.pk, mine.locale, "/shared-slug") is None


def test_sibling_ordering_follows_position(sites):
    site, _ = sites
    create_page(site=site, title="Third", slug="third", position=30)
    create_page(site=site, title="First", slug="first", position=10)
    create_page(site=site, title="Second", slug="second", position=20)
    assert list(Page.objects.filter(parent=None).values_list("slug", flat=True)) == [
        "first", "second", "third",
    ]


def _publish_for_test(page):
    author, reviewer, publisher = [
        get_user_model().objects.create_user(
            username=f"public-test-{page.slug}-{role}",
        )
        for role in ("author", "reviewer", "publisher")
    ]
    for action, actor in (
        ("submit", author), ("approve", reviewer), ("publish", publisher),
    ):
        transition_content(
            page.pk, action=action, actor=actor, roles={"platform-admin"},
        )
