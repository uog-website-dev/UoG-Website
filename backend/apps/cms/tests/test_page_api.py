"""Site-scoped Page authoring and host-resolved public delivery contracts."""
import pytest
from django.contrib.auth import get_user_model

from apps.cms.models import (
    ContentRole,
    ContentStatus,
    Page,
    SiteContentRoleAssignment,
    SitePublicationVersion,
)
from apps.cms.services.pages import change_route
from apps.cms.services.publication_cache import (
    current_publication_version,
    get_public_cache,
    public_cache_key,
)
from apps.cms.services.workflow import transition_content
from apps.sites.models import Module, SiteDomain
from apps.sites.services.lifecycle import activate_site
from apps.sites.services.modules import (
    disable_module_for_site,
    enable_module_for_site,
)


pytestmark = pytest.mark.django_db

ADMIN_PAGES = "/api/v1/sites/{site_id}/pages/"
PUBLIC_PAGES = "/api/v1/site-context/pages/"


def _token(oidc, subject, username, roles=("platform-viewer",)):
    return oidc.header(
        sub=subject,
        preferred_username=username,
        email=f"{username}@uog.et",
        realm_access={"roles": list(roles)},
    )


def _enable_pages_module(sites):
    module = Module.objects.get(code="PAGES")
    if not module.is_enabled:
        module.is_enabled = True
        module.save(update_fields=("is_enabled",))
    for site in sites:
        enable_module_for_site(site.pk, module.pk)


def _enable_public_pages(sites):
    _enable_pages_module(sites)
    for site in sites:
        activate_site(site.pk)
        SiteDomain.objects.create(
            site=site,
            hostname=f"site-{site.pk}.uog.edu.et",
            is_primary=True,
            status=SiteDomain.Status.ACTIVE,
        )


def _publish(page, *, title=None):
    actor = get_user_model().objects.create_user(
        username=f"public-{page.slug}-{Page.objects.count()}",
    )
    if title is not None:
        page.title = title
        page.updated_by = actor
        page.save()
    transition_content(
        page.pk, action="submit", actor=actor, roles={"platform-admin"},
    )
    reviewer = get_user_model().objects.create_user(
        username=f"reviewer-{page.slug}-{Page.objects.count()}",
    )
    transition_content(
        page.pk, action="approve", actor=reviewer, roles={"platform-admin"},
    )
    publisher = get_user_model().objects.create_user(
        username=f"publisher-{page.slug}-{Page.objects.count()}",
    )
    return transition_content(
        page.pk, action="publish", actor=publisher, roles={"platform-admin"},
    )


def test_admin_pages_are_site_scoped_filterable_and_conditionally_updated(
    client, oidc, pages_module, sites,
):
    site, other_site = sites
    _enable_pages_module((site,))
    client.defaults.update(oidc.header())
    client.get("/api/me/")
    page_url = ADMIN_PAGES.format(site_id=site.pk)
    created = client.post(
        page_url,
        {"title": "Admissions", "slug": "admissions"},
        content_type="application/json",
    )
    assert created.status_code == 201, created.content
    page_id = created.json()["id"]
    etag = created["ETag"]

    listed = client.get(f"{page_url}?status=DRAFT&search=admissions")
    assert listed.status_code == 200
    assert listed.json()["count"] == 1
    assert listed.json()["results"][0]["id"] == page_id
    paginated = client.get(f"{page_url}?page=1&page_size=1")
    assert paginated.status_code == 200
    assert paginated.json()["count"] == 1
    assert client.get(f"{page_url}?site_id={other_site.pk}").status_code == 400

    detail = client.get(f"{page_url}{page_id}/")
    assert detail.status_code == 200
    assert detail["ETag"] == etag
    assert client.get(
        f"{ADMIN_PAGES.format(site_id=other_site.pk)}{page_id}/",
    ).status_code == 404

    missing_etag = client.patch(
        f"{page_url}{page_id}/",
        {"title": "Changed"},
        content_type="application/json",
    )
    assert missing_etag.status_code == 428
    changed = client.patch(
        f"{page_url}{page_id}/",
        {"title": "Changed"},
        content_type="application/json",
        HTTP_IF_MATCH=etag,
    )
    assert changed.status_code == 200, changed.content
    assert changed.json()["title"] == "Changed"
    stale = client.patch(
        f"{page_url}{page_id}/",
        {"title": "Lost update"},
        content_type="application/json",
        HTTP_IF_MATCH=etag,
    )
    assert stale.status_code == 409
    assert Page.objects.get(pk=page_id).title == "Changed"

    current_etag = client.get(f"{page_url}{page_id}/")["ETag"]
    renamed = client.patch(
        f"{page_url}{page_id}/",
        {"slug": "admissions-updated"},
        content_type="application/json",
        HTTP_IF_MATCH=current_etag,
    )
    assert renamed.status_code == 200, renamed.content
    assert renamed.json()["path"] == "/admissions-updated"
    assert Page.objects.get(pk=page_id).redirects.filter(
        old_path="/admissions",
    ).exists()

    submitted = client.post(
        f"{page_url}{page_id}/workflow/",
        {"action": "submit"},
        content_type="application/json",
    )
    assert submitted.status_code == 200, submitted.content
    assert submitted.json()["status"] == ContentStatus.IN_REVIEW


def test_page_authoring_requires_an_active_site_author_role(
    client, oidc, pages_module, sites,
):
    site, _ = sites
    _enable_pages_module((site,))
    outsider = get_user_model().objects.create_user(username="pages-outsider")
    denied = client.post(
        ADMIN_PAGES.format(site_id=site.pk),
        {"title": "Denied", "slug": "denied"},
        content_type="application/json",
        **_token(oidc, "5f1b2c3d-0000-4000-8000-000000000033", outsider.username),
    )
    assert denied.status_code == 403

    SiteContentRoleAssignment.objects.create(
        site=site, user=outsider, role=ContentRole.AUTHOR,
    )
    created = client.post(
        ADMIN_PAGES.format(site_id=site.pk),
        {"title": "Allowed", "slug": "allowed"},
        content_type="application/json",
        **_token(oidc, "5f1b2c3d-0000-4000-8000-000000000033", outsider.username),
    )
    assert created.status_code == 201, created.content


def test_database_platform_administrator_can_author_without_keycloak_role(
    client, oidc, pages_module, sites,
):
    """Platform access comes from the active DB assignment, not a duplicate claim."""
    from django.core.management import call_command
    from apps.authorization.models import Role, UserRoleAssignment

    site, _ = sites
    _enable_pages_module((site,))
    client.defaults.update(oidc.header(realm_access={"roles": ["platform-viewer"]}))
    assert client.get("/api/me/").status_code == 200
    call_command("seed_rbac", verbosity=0)
    user = get_user_model().objects.get(username="devuser")
    UserRoleAssignment.objects.create(
        user=user,
        role=Role.objects.get(code="platform-administrator"),
        scope=UserRoleAssignment.Scope.PLATFORM,
    )

    url = ADMIN_PAGES.format(site_id=site.pk)
    created = client.post(
        url,
        {"title": "Platform draft", "slug": "platform-draft"},
        content_type="application/json",
    )
    assert created.status_code == 201, created.content
    listed = client.get(url)
    assert listed.status_code == 200, listed.content


def test_page_reparenting_is_same_site_and_keeps_route_history(
    client, oidc, pages_module, sites,
):
    site, other_site = sites
    _enable_pages_module((site, other_site))
    client.defaults.update(oidc.header())
    parent = Page.objects.create(site=site, title="Parent", slug="parent")
    foreign_parent = Page.objects.create(
        site=other_site, title="Foreign parent", slug="foreign-parent",
    )
    page = Page.objects.create(site=site, title="Child", slug="child")
    url = f"{ADMIN_PAGES.format(site_id=site.pk)}{page.pk}/"
    etag = client.get(url)["ETag"]

    moved = client.patch(
        url,
        {"parent": str(parent.pk)},
        content_type="application/json",
        HTTP_IF_MATCH=etag,
    )
    assert moved.status_code == 200, moved.content
    assert moved.json()["path"] == "/parent/child"
    assert page.redirects.filter(old_path="/child").exists()

    current_etag = moved["ETag"]
    cross_site = client.patch(
        url,
        {"parent": str(foreign_parent.pk)},
        content_type="application/json",
        HTTP_IF_MATCH=current_etag,
    )
    assert cross_site.status_code == 400


def test_public_routes_are_host_scoped_published_only_and_snapshot_backed(
    client, settings, sites,
):
    settings.ALLOWED_HOSTS = ["*"]
    site, other_site = sites
    _enable_public_pages((site, other_site))
    mine = Page.objects.create(
        site=site, title="Mine", slug="mine", is_homepage=True,
    )
    foreign = Page.objects.create(site=other_site, title="Foreign", slug="foreign-only")
    draft = Page.objects.create(site=site, title="Draft", slug="still-draft")
    hidden = Page.objects.create(
        site=site, title="Hidden", slug="hidden", visibility="HIDDEN",
    )
    unlisted = Page.objects.create(
        site=site, title="Unlisted", slug="unlisted", visibility="UNLISTED",
    )
    redirected = Page.objects.create(
        site=site, title="Route history", slug="old-route",
    )
    change_route(redirected, slug="new-route")
    _publish(mine)
    _publish(foreign)
    _publish(hidden)
    _publish(unlisted)
    _publish(redirected)
    homepage_slug = Page.objects.create(
        site=site, title="Homepage path", slug="homepage",
    )
    _publish(homepage_slug)

    host = f"site-{site.pk}.uog.edu.et"
    own = client.get(
        f"{PUBLIC_PAGES}mine/",
        HTTP_HOST=host,
    )
    assert own.status_code == 200
    assert own.json()["title"] == "Mine"
    assert own.json()["publication_version"] == 1
    assert own.json()["blocks"] == mine.publication_snapshots.get().payload["blocks"]
    homepage = client.get(
        "/api/v1/site-context/homepage/", HTTP_HOST=host,
    )
    assert homepage.status_code == 200
    assert homepage.json()["slug"] == "mine"
    assert client.get(
        f"{PUBLIC_PAGES}homepage/", HTTP_HOST=host,
    ).json()["slug"] == "homepage"

    assert client.get(
        f"{PUBLIC_PAGES}still-draft/", HTTP_HOST=host,
    ).status_code == 404
    assert client.get(
        f"{PUBLIC_PAGES}foreign-only/",
        HTTP_HOST=host,
    ).status_code == 404
    assert client.get(
        f"{PUBLIC_PAGES}hidden/", HTTP_HOST=host,
    ).status_code == 404
    assert client.get(
        f"{PUBLIC_PAGES}unlisted/", HTTP_HOST=host,
    ).status_code == 200
    old_route = client.get(
        f"{PUBLIC_PAGES}old-route/", HTTP_HOST=host,
    )
    assert old_route.status_code == 308
    assert old_route["Location"] == f"{PUBLIC_PAGES}new-route/"
    assert client.get(
        f"{PUBLIC_PAGES}foreign-only/",
        HTTP_HOST=f"site-{other_site.pk}.uog.edu.et",
    ).status_code == 200
    listing = client.get(
        f"{PUBLIC_PAGES}?page=1&page_size=100", HTTP_HOST=host,
    )
    assert listing.status_code == 200
    assert {
        entry["slug"] for entry in listing.json()["results"]
    } == {"mine", "new-route", "homepage"}
    assert client.get(
        f"{PUBLIC_PAGES}mine/?site_id={other_site.pk}", HTTP_HOST=host,
    ).status_code == 400
    assert client.get(
        f"{PUBLIC_PAGES}mine/", HTTP_HOST="unregistered.uog.edu.et",
    ).status_code == 404


def test_publication_versions_invalidate_public_cache_on_unpublish(
    client, settings, sites,
):
    settings.ALLOWED_HOSTS = ["*"]
    site, _ = sites
    _enable_public_pages((site,))
    page = Page.objects.create(site=site, title="Welcome", slug="welcome")
    _publish(page)
    host = f"site-{site.pk}.uog.edu.et"
    url = f"{PUBLIC_PAGES}welcome/"
    cached = client.get(url, HTTP_HOST=host)
    assert cached.status_code == 200
    old_version = current_publication_version(site.pk, page.locale)
    old_key = public_cache_key(
        site.pk, page.locale, f"page:{page.path}", version=old_version,
    )
    assert get_public_cache(site.pk, old_key) is not None
    initial_list = client.get(PUBLIC_PAGES, HTTP_HOST=host)
    assert initial_list.json()["count"] == 1
    old_list_key = public_cache_key(
        site.pk, page.locale, "list:parent=:page=1:size=20",
        version=old_version,
    )
    assert get_public_cache(site.pk, old_list_key) is not None

    next_page = Page.objects.create(
        site=site, title="Next", slug="next",
    )
    _publish(next_page)
    published_version = current_publication_version(site.pk, page.locale)
    assert published_version == old_version + 1
    refreshed_list = client.get(PUBLIC_PAGES, HTTP_HOST=host)
    assert refreshed_list.json()["count"] == 2
    assert refreshed_list["X-Publication-Version"] == str(published_version)
    assert client.get(url, HTTP_HOST=host).status_code == 200

    publisher = get_user_model().objects.create_user(username="public-unpublisher")
    transition_content(
        page.pk, action="unpublish", actor=publisher, roles={"platform-admin"},
    )
    assert SitePublicationVersion.objects.get(
        site=site, locale=page.locale,
    ).version == published_version + 1
    current_page_key = public_cache_key(
        site.pk, page.locale, f"page:{page.path}", version=published_version,
    )
    assert get_public_cache(site.pk, current_page_key) is None
    assert client.get(url, HTTP_HOST=host).status_code == 404
    assert client.get(PUBLIC_PAGES, HTTP_HOST=host).json()["count"] == 1


def test_disabling_pages_blocks_management_and_delivery_but_keeps_content(
    client, oidc, platform_admin, pages_module, settings, sites,
):
    settings.ALLOWED_HOSTS = ["*"]
    site, _ = sites
    _enable_public_pages((site,))
    host = {"HTTP_HOST": f"site-{site.pk}.uog.edu.et"}
    page_url = ADMIN_PAGES.format(site_id=site.pk)

    created = client.post(
        page_url,
        {"title": "Retained", "slug": "retained"},
        content_type="application/json",
    )
    assert created.status_code == 201, created.content
    page_id = created.json()["id"]
    _publish(Page.objects.get(pk=page_id))
    assert client.get(f"{PUBLIC_PAGES}retained/", **host).status_code == 200

    disable_module_for_site(site.pk, pages_module.pk)

    retained_list = client.get(page_url)
    assert retained_list.status_code == 200
    assert retained_list.json()["count"] == 1
    assert client.get(f"{page_url}{page_id}/").status_code == 200
    assert client.post(
        page_url,
        {"title": "Blocked", "slug": "blocked"},
        content_type="application/json",
    ).status_code == 400
    assert client.get(f"{PUBLIC_PAGES}retained/", **host).status_code == 404

    enable_module_for_site(site.pk, pages_module.pk)

    restored = client.get(page_url)
    assert restored.status_code == 200
    assert restored.json()["count"] == 1
    assert Page.objects.filter(pk=page_id).exists()
    assert client.get(f"{PUBLIC_PAGES}retained/", **host).status_code == 200


def test_public_delivery_is_closed_when_the_pages_module_is_not_enabled(
    client, settings, sites,
):
    settings.ALLOWED_HOSTS = ["*"]
    site, _ = sites
    activate_site(site.pk)
    SiteDomain.objects.create(
        site=site,
        hostname=f"disabled-{site.pk}.uog.edu.et",
        is_primary=True,
        status=SiteDomain.Status.ACTIVE,
    )
    response = client.get(
        PUBLIC_PAGES,
        HTTP_HOST=f"disabled-{site.pk}.uog.edu.et",
    )
    assert response.status_code == 404


def test_disabling_pages_blocks_management_without_deleting_the_page(
    client, oidc, settings, sites,
):
    settings.ALLOWED_HOSTS = ["*"]
    site, other_site = sites
    _enable_public_pages((site,))
    client.defaults.update(oidc.header())
    client.get("/api/me/")
    page_url = ADMIN_PAGES.format(site_id=site.pk)
    created = client.post(
        page_url,
        {
            "title": "Admissions",
            "slug": "admissions",
            "blocks": [{
                "type": "paragraph",
                "html": "<p>Open<script>alert(1)</script></p>",
            }],
        },
        content_type="application/json",
    )
    assert created.status_code == 201, created.content
    page_id = created.json()["id"]
    assert "<script" not in created.json()["blocks"][0]["html"]
    module = Module.objects.get(code="PAGES")
    from apps.sites.services.modules import disable_module_for_site
    disable_module_for_site(site.pk, module.pk)

    listed = client.get(page_url)
    assert listed.status_code == 200
    assert listed.json()["results"][0]["id"] == page_id
    blocked = client.post(
        page_url,
        {"title": "Another", "slug": "another"},
        content_type="application/json",
    )
    assert blocked.status_code == 400
    assert blocked.json()["error"]["details"]["reason"] == "module_disabled"
    etag = client.get(f"{page_url}{page_id}/")["ETag"]
    edited = client.patch(
        f"{page_url}{page_id}/",
        {"title": "Changed"},
        content_type="application/json",
        HTTP_IF_MATCH=etag,
    )
    assert edited.status_code == 400
    assert edited.json()["error"]["details"]["reason"] == "module_disabled"
    submitted = client.post(
        f"{page_url}{page_id}/workflow/",
        {"action": "submit"},
        content_type="application/json",
    )
    assert submitted.status_code == 400
    assert submitted.json()["error"]["details"]["reason"] == "module_disabled"
    assert Page.objects.get(pk=page_id).title == "Admissions"
    assert client.get(
        PUBLIC_PAGES, HTTP_HOST=f"site-{site.pk}.uog.edu.et",
    ).status_code == 404
    assert Page.objects.filter(pk=page_id).exists()
    assert not Page.objects.filter(site=other_site, slug="another").exists()


def test_homepage_assignment_publish_and_rejection_stay_on_one_site(
    client, oidc, settings, sites,
):
    settings.ALLOWED_HOSTS = ["*"]
    site, other_site = sites
    _enable_public_pages((site, other_site))
    client.defaults.update(oidc.header())
    client.get("/api/me/")
    page_url = ADMIN_PAGES.format(site_id=site.pk)
    created = client.post(
        page_url,
        {"title": "Welcome", "slug": "welcome"},
        content_type="application/json",
    )
    assert created.status_code == 201, created.content
    page_id = created.json()["id"]
    homepage = client.post(f"{page_url}{page_id}/homepage/")
    assert homepage.status_code == 200, homepage.content
    assert homepage.json()["is_homepage"] is True
    assert client.post(
        f"{ADMIN_PAGES.format(site_id=other_site.pk)}{page_id}/homepage/",
    ).status_code == 404

    submitted = client.post(
        f"{page_url}{page_id}/workflow/",
        {"action": "submit"},
        content_type="application/json",
    )
    assert submitted.status_code == 200
    reviewer = get_user_model().objects.create_user(username="homepage-reviewer")
    rejected = client.post(
        f"{page_url}{page_id}/workflow/",
        {"action": "reject", "comment": "Needs a clearer title."},
        content_type="application/json",
    )
    assert rejected.status_code == 403
    SiteContentRoleAssignment.objects.create(
        site=site, user=reviewer, role=ContentRole.REVIEWER,
    )
    rejected = client.post(
        f"{page_url}{page_id}/workflow/",
        {"action": "reject", "comment": "Needs a clearer title."},
        content_type="application/json",
        **_token(oidc, "5f1b2c3d-0000-4000-8000-000000000044", reviewer.username),
    )
    assert rejected.status_code == 200, rejected.content
    assert rejected.json()["status"] == ContentStatus.DRAFT
    host = f"site-{site.pk}.uog.edu.et"
    assert client.get(
        "/api/v1/site-context/homepage/", HTTP_HOST=host,
    ).status_code == 404
    assert client.get(
        f"{PUBLIC_PAGES}welcome/", HTTP_HOST=host,
    ).status_code == 404
