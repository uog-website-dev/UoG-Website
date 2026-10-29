"""change_route keeps URL history: subtree redirects, no chains, live wins."""
import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from apps.cms.models import PageRedirect
from apps.cms.selectors.pages import resolve_redirect
from apps.cms.services.pages import change_route, create_page

pytestmark = pytest.mark.django_db


def test_a_slug_change_records_the_old_route(sites):
    site, _ = sites
    about = create_page(site=site, title="About", slug="about")
    change_route(about, slug="about-us")
    assert about.path == "/about-us"
    history = resolve_redirect(site.pk, about.locale, "/about")
    assert history is not None
    assert history.page_id == about.pk
    # The live route itself has no history entry.
    assert resolve_redirect(site.pk, about.locale, "/about-us") is None


def test_moving_an_ancestor_records_every_descendant_route(sites):
    site, _ = sites
    old_parent = create_page(site=site, title="Old", slug="old")
    new_parent = create_page(site=site, title="New", slug="new")
    child = create_page(site=site, title="Child", slug="child", parent=old_parent)
    grandchild = create_page(site=site, title="Grand", slug="grand", parent=child)
    change_route(old_parent, parent=new_parent)
    assert old_parent.path == "/new/old"
    # _descendants works on database copies; read the committed state back.
    child.refresh_from_db()
    grandchild.refresh_from_db()
    assert child.path == "/new/old/child"
    assert grandchild.path == "/new/old/child/grand"
    for vanished in ("/old", "/old/child", "/old/child/grand"):
        entry = resolve_redirect(site.pk, child.locale, vanished)
        assert entry is not None, vanished
        assert entry.page is not None
    # Redirects are re-pointed at current paths, never chained.
    entry = resolve_redirect(site.pk, child.locale, "/old/child")
    assert entry.page.path == "/new/old/child"


def test_detaching_to_the_root_records_history(sites):
    site, _ = sites
    parent = create_page(site=site, title="Parent", slug="parent")
    child = create_page(site=site, title="Child", slug="child", parent=parent)
    change_route(child, parent=None)
    assert child.path == "/child"
    entry = resolve_redirect(site.pk, child.locale, "/parent/child")
    assert entry is not None and entry.page_id == child.pk


def test_returning_to_a_former_route_never_shadows_the_live_page(sites):
    site, _ = sites
    page = create_page(site=site, title="Page", slug="alpha")
    change_route(page, slug="beta")
    assert resolve_redirect(site.pk, page.locale, "/alpha").page_id == page.pk
    change_route(page, slug="alpha")
    assert page.path == "/alpha"
    # The route is live again, so its own history entry is removed.
    assert resolve_redirect(site.pk, page.locale, "/alpha") is None
    assert resolve_redirect(site.pk, page.locale, "/beta").page_id == page.pk


def test_redirect_rows_are_unique_per_site_and_locale(sites):
    site, _ = sites
    page = create_page(site=site, title="Page", slug="page")
    PageRedirect.objects.create(
        site=site, page=page, locale=page.locale, old_path="/former",
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        PageRedirect.objects.create(
            site=site, page=page, locale=page.locale, old_path="/former",
        )


def test_history_disappears_with_the_page(sites):
    site, _ = sites
    leaf = create_page(site=site, title="Leaf", slug="leaf")
    change_route(leaf, slug="renamed")
    assert PageRedirect.objects.filter(page=leaf).count() == 1
    leaf.delete()
    assert not PageRedirect.objects.exists()


def test_a_route_change_is_transactional(sites):
    site, _ = sites
    parent = create_page(site=site, title="Parent", slug="parent")
    child = create_page(site=site, title="Child", slug="child", parent=parent)
    # A move onto an occupied route fails as a whole: the parent's new slug
    # collides with `taken`, so no path moved, no redirects written.
    taken = create_page(site=site, title="Taken", slug="taken")
    with pytest.raises(ValidationError):
        change_route(parent, slug="taken")
    parent.refresh_from_db()
    child.refresh_from_db()
    assert parent.path == "/parent"
    assert child.path == "/parent/child"
    assert not PageRedirect.objects.exists()
