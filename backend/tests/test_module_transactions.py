"""Module writes must commit under PostgreSQL autocommit.

pytest-django's default database fixture wraps a test in a transaction, and
``select_for_update`` succeeds inside that wrapper. These tests leave
autocommit on, so a lock taken outside ``registry_write`` fails the request.
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from threading import Barrier

import pytest
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connections, transaction
from django.test import Client

from apps.api.models import Post
from apps.cms.menu_models import Menu
from apps.cms.models import Page
from apps.cms.tests.support import transition_with_site_role
from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.sites.configuration import default_configuration
from apps.sites.models import Module, Site, SiteDomain, SiteModule, SiteTemplate
from apps.sites.module_schema import empty_module_schema
from apps.sites.services.lifecycle import activate_site


pytestmark = pytest.mark.django_db(transaction=True)

MODULES = "/api/v1/modules/"
TEMPLATES = "/api/v1/site-templates/"
PUBLIC_PAGES = "/api/v1/site-context/pages/"
PUBLIC_POSTS = "/api/v1/site-context/posts/"
PUBLIC_MENUS = "/api/v1/site-context/menus/"


def _etag(response):
    return response["ETag"]


def _owner():
    college, _ = OrganizationType.objects.get_or_create(code="COLLEGE", defaults={"name": "College"})
    university, _ = OrganizationType.objects.get_or_create(code="UNIVERSITY", defaults={"name": "University"})
    root = OrganizationUnit.objects.create(code="ATOM-UOG", name="Atomic University", organization_type=university)
    return OrganizationUnit.objects.create(code="ATOM-CI", name="Atomic College", organization_type=college, parent=root)


def _site(owner, code, name):
    site = Site.objects.create(organization_unit=owner, code=code, name=name)
    activate_site(site.pk)
    SiteDomain.objects.create(
        site=site, hostname=f"{code.lower()}.uog.edu.et",
        is_primary=True, status=SiteDomain.Status.ACTIVE,
    )
    return site


def _module(code):
    return Module.objects.get(code=code)


def _registry():
    """Reload the shipped registry after the autocommit fixture truncates seed rows."""
    shipped = (
        ("PAGES", "Pages", "Site-scoped page authoring and published-only public delivery APIs."),
        ("POSTS", "Posts", "Site-scoped post authoring and taxonomy administration. Editing requires the module to be enabled for the Site; disabling it keeps existing rows."),
        ("MENUS", "Menus", "Site-owned menu trees. Editing requires the module to be enabled for the Site; disabling it keeps existing rows."),
    )
    with connections["default"].cursor() as cursor:
        cursor.execute(
            "INSERT INTO sites_module_implementation (code) VALUES ('PAGES'), ('POSTS'), ('MENUS') "
            "ON CONFLICT (code) DO NOTHING"
        )
    for code, name, description in shipped:
        Module.objects.create(
            code=code, name=name, description=description,
            status=Module.Status.IMPLEMENTED, is_enabled=False,
            configuration_schema=empty_module_schema(),
        )
    Module.objects.create(
        code="EVENTS", name="Events",
        description="Registered events capability. It is not implemented and cannot be enabled for a Site.",
        status=Module.Status.PLANNED, is_enabled=False,
        configuration_schema=empty_module_schema(),
    )
    SiteTemplate.objects.create(
        code="COLLEGE", name="College",
        description="Approved starting configuration for a college website.",
        status=SiteTemplate.Status.ACTIVE,
        default_configuration=default_configuration("en-us"),
    )


def _enable_global(admin, code):
    module = _module(code)
    detail = admin.get(f"{MODULES}{module.pk}/")
    assert detail.status_code == 200, detail.content
    updated = admin.patch(
        f"{MODULES}{module.pk}/",
        {"status": "IMPLEMENTED", "is_enabled": True},
        content_type="application/json",
        HTTP_IF_MATCH=_etag(detail),
    )
    assert updated.status_code == 200, updated.content
    assert updated.json()["is_enabled"] is True
    return updated


def _assign(admin, site, module, configuration=None):
    created = admin.post(
        f"/api/v1/sites/{site.pk}/modules/",
        {"module": module.pk, "configuration": {} if configuration is None else configuration},
        content_type="application/json",
    )
    assert created.status_code == 201, created.content
    return created


def _publish_page(page):
    for action in ("submit", "approve", "publish"):
        actor = get_user_model().objects.create_user(username=f"atom-{action}-{page.pk}")
        transition_with_site_role(page, action, actor)
    page.refresh_from_db()


@pytest.fixture
def admin(platform_admin_client, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    settings.ALLOWED_HOSTS = ["*"]
    settings.CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "KEY_PREFIX": settings.CACHE_KEY_PREFIX,
            "KEY_FUNCTION": "apps.core.cache.make_cache_key",
        }
    }
    return platform_admin_client


def test_autocommit_is_on_for_this_module(admin):
    assert transaction.get_autocommit() is True
    assert connections["default"].in_atomic_block is False


def test_platform_switch_works_in_production_without_opening_catalogue_edits(admin, settings, oidc):
    _registry()
    settings.DEBUG = False
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = False
    module = _module("PAGES")
    path = f"{MODULES}{module.pk}/"
    original = admin.get(path)
    enabled = admin.patch(path, {"is_enabled": True}, content_type="application/json", HTTP_IF_MATCH=_etag(original))
    assert enabled.status_code == 200, enabled.content
    module.refresh_from_db()
    assert module.is_enabled is True
    assert not SiteModule.objects.filter(module=module).exists()

    stale = admin.patch(path, {"is_enabled": False}, content_type="application/json", HTTP_IF_MATCH=_etag(original))
    assert stale.status_code == 412
    missing = admin.patch(path, {"is_enabled": False}, content_type="application/json")
    assert missing.status_code == 428
    blocked = admin.patch(path, {"is_enabled": False, "name": "Changed"}, content_type="application/json", HTTP_IF_MATCH=_etag(enabled))
    assert blocked.status_code == 403
    module.refresh_from_db()
    assert module.is_enabled is True and module.name == "Pages"

    foreign = Client()
    foreign.defaults.update(oidc.header(sub="10000000-0000-4000-8000-000000000001", preferred_username="no-module-grant"))
    denied = foreign.patch(path, {"is_enabled": False}, content_type="application/json", HTTP_IF_MATCH=_etag(enabled))
    assert denied.status_code == 403
    assert Client().patch(path, {"is_enabled": False}, content_type="application/json").status_code == 401

    disabled = admin.patch(path, {"is_enabled": False}, content_type="application/json", HTTP_IF_MATCH=_etag(enabled))
    assert disabled.status_code == 200, disabled.content
    module.refresh_from_db()
    assert module.is_enabled is False
    planned_path = f"{MODULES}{_module('EVENTS').pk}/"
    planned = admin.get(planned_path)
    rejected = admin.patch(planned_path, {"is_enabled": True}, content_type="application/json", HTTP_IF_MATCH=_etag(planned))
    assert rejected.status_code == 400, rejected.content
    assert _module("EVENTS").is_enabled is False


def test_global_and_site_module_changes_commit_and_isolate_sites(admin):
    assert transaction.get_autocommit() is True
    _registry()
    owner = _owner()
    events = _module("EVENTS")
    original_name = events.name
    detail = admin.get(f"{MODULES}{events.pk}/")
    rejected = admin.patch(
        f"{MODULES}{events.pk}/",
        {"name": "Should not persist", "status": "IMPLEMENTED", "is_enabled": True},
        content_type="application/json",
        HTTP_IF_MATCH=_etag(detail),
    )
    assert rejected.status_code == 400, rejected.content
    events.refresh_from_db()
    assert events.name == original_name
    assert events.status == "PLANNED" and events.is_enabled is False

    pages = _enable_global(admin, "PAGES")
    posts = _enable_global(admin, "POSTS")
    menus = _enable_global(admin, "MENUS")
    site_a = _site(owner, "ATOM-A", "Site A")
    site_b = _site(owner, "ATOM-B", "Site B")
    blocked = admin.post(
        f"/api/v1/sites/{site_a.pk}/modules/",
        {"module": events.pk, "configuration": {}},
        content_type="application/json",
    )
    assert blocked.status_code == 400, blocked.content
    assert SiteModule.objects.filter(site=site_a, module=events).count() == 0

    kept = {}
    first = _assign(admin, site_a, _module("PAGES"), kept)
    assert first.json()["module_code"] == "PAGES"
    assert first.json()["configuration"] == kept
    other = _assign(admin, site_b, _module("PAGES"))
    posts_row = _assign(admin, site_a, _module("POSTS"))
    menus_row = _assign(admin, site_a, _module("MENUS"))
    assert admin.post(
        f"/api/v1/sites/{site_a.pk}/modules/",
        {"module": _module("PAGES").pk, "configuration": {}},
        content_type="application/json",
    ).status_code == 409

    page = admin.post(
        f"/api/v1/sites/{site_a.pk}/pages/",
        {"title": "Retained page", "slug": "retained-page"},
        content_type="application/json",
    )
    assert page.status_code == 201, page.content
    _publish_page(Page.objects.get(pk=page.json()["id"]))
    post = admin.post(
        f"/api/v1/sites/{site_a.pk}/posts/",
        {"title": "Retained post", "slug": "retained-post", "content": "Kept"},
        content_type="application/json",
    )
    assert post.status_code == 201, post.content
    menu = admin.post(
        f"/api/v1/sites/{site_a.pk}/menus/",
        {"name": "Retained menu", "location": "header"},
        content_type="application/json",
    )
    assert menu.status_code == 201, menu.content
    host_a = {"HTTP_HOST": "atom-a.uog.edu.et"}
    assert admin.get(f"{PUBLIC_PAGES}retained-page/", **host_a).status_code == 200

    turned_off = admin.post(
        first["Location"] + "disable/", {},
        content_type="application/json", HTTP_IF_MATCH=_etag(first),
    )
    assert turned_off.status_code == 200, turned_off.content
    assert turned_off.json()["is_enabled"] is False
    assert turned_off.json()["configuration"] == kept
    stored = SiteModule.objects.get(pk=first.json()["id"])
    assert stored.is_enabled is False and stored.configuration == kept
    assert SiteModule.objects.get(pk=other.json()["id"]).is_enabled is True
    assert admin.get(f"/api/v1/sites/{site_b.pk}/modules/{first.json()['id']}/").status_code == 404

    page_url = f"/api/v1/sites/{site_a.pk}/pages/"
    inspected = admin.get(page_url)
    assert inspected.status_code == 200 and inspected.json()["count"] == 1
    assert admin.get(f"{page_url}{page.json()['id']}/").status_code == 200
    blocked_page = admin.post(
        page_url, {"title": "Blocked", "slug": "blocked-page"},
        content_type="application/json",
    )
    assert blocked_page.status_code == 400
    assert blocked_page.json()["error"]["details"]["reason"] == "module_disabled"
    assert admin.get(f"{PUBLIC_PAGES}retained-page/", **host_a).status_code == 404
    assert Page.objects.filter(pk=page.json()["id"], title="Retained page").exists()
    assert admin.post(
        f"/api/v1/sites/{site_b.pk}/pages/",
        {"title": "Site B page", "slug": "site-b-page"},
        content_type="application/json",
    ).status_code == 201

    posts_off = admin.post(
        posts_row["Location"] + "disable/", {},
        content_type="application/json", HTTP_IF_MATCH=_etag(posts_row),
    )
    assert posts_off.status_code == 200 and posts_off.json()["is_enabled"] is False
    blocked_post = admin.post(
        f"/api/v1/sites/{site_a.pk}/posts/",
        {"title": "Blocked post", "slug": "blocked-post", "content": "No"},
        content_type="application/json",
    )
    assert blocked_post.status_code == 400, blocked_post.content
    assert admin.get(PUBLIC_POSTS, **host_a).status_code == 404
    assert Post.objects.filter(pk=post.json()["id"], title="Retained post").exists()

    menus_off = admin.post(
        menus_row["Location"] + "disable/", {},
        content_type="application/json", HTTP_IF_MATCH=_etag(menus_row),
    )
    assert menus_off.status_code == 200 and menus_off.json()["is_enabled"] is False
    listed_menus = admin.get(f"/api/v1/sites/{site_a.pk}/menus/")
    assert listed_menus.status_code == 200
    assert listed_menus.json()["count"] == 1
    blocked_menu = admin.post(
        f"/api/v1/sites/{site_a.pk}/menus/",
        {"name": "Blocked menu", "location": "footer"},
        content_type="application/json",
    )
    assert blocked_menu.status_code == 400
    assert blocked_menu.json()["error"]["details"]["reason"] == "module_disabled"
    assert admin.get(PUBLIC_MENUS, **host_a).status_code == 404
    assert Menu.objects.filter(pk=menu.json()["id"], name="Retained menu").exists()

    restored = admin.post(
        first["Location"] + "enable/", {},
        content_type="application/json", HTTP_IF_MATCH=_etag(turned_off),
    )
    assert restored.status_code == 200, restored.content
    assert restored.json()["is_enabled"] is True
    assert restored.json()["configuration"] == kept
    assert admin.get(f"{PUBLIC_PAGES}retained-page/", **host_a).status_code == 200
    assert pages.json()["is_enabled"] and posts.json()["is_enabled"] and menus.json()["is_enabled"]


def test_stale_module_etag_does_not_overwrite_the_committed_row(admin):
    _registry()
    module = _module("PAGES")
    detail = admin.get(f"{MODULES}{module.pk}/")
    etag = _etag(detail)
    renamed = admin.patch(
        f"{MODULES}{module.pk}/",
        {"name": "Pages current"},
        content_type="application/json",
        HTTP_IF_MATCH=etag,
    )
    assert renamed.status_code == 200, renamed.content
    stale = admin.patch(
        f"{MODULES}{module.pk}/",
        {"name": "Pages stale"},
        content_type="application/json",
        HTTP_IF_MATCH=etag,
    )
    assert stale.status_code == 412, stale.content
    missing = admin.patch(
        f"{MODULES}{module.pk}/",
        {"name": "Pages missing"},
        content_type="application/json",
    )
    assert missing.status_code == 428
    module.refresh_from_db()
    assert module.name == "Pages current"


def test_concurrent_module_updates_keep_one_winner(admin):
    _registry()
    module = _module("PAGES")
    detail = admin.get(f"{MODULES}{module.pk}/")
    etag = _etag(detail)
    token = admin.defaults["HTTP_AUTHORIZATION"]
    url = f"{MODULES}{module.pk}/"
    barrier = Barrier(3)

    def attempt(name):
        close_old_connections()
        try:
            with connections["default"].cursor() as cursor:
                cursor.execute("SET lock_timeout = '5s'")
                cursor.execute("SET statement_timeout = '10s'")
            barrier.wait(timeout=10)
            response = Client().patch(
                url, {"name": name}, content_type="application/json",
                HTTP_IF_MATCH=etag, HTTP_AUTHORIZATION=token,
            )
            return response.status_code
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(attempt, name) for name in ("Pages left", "Pages right")]
        barrier.wait(timeout=10)
        statuses = sorted(future.result(timeout=20) for future in futures)
    assert statuses == [200, 412]
    module.refresh_from_db()
    assert module.name in {"Pages left", "Pages right"}


def test_audit_context_failure_rolls_the_module_change_back(admin, monkeypatch):
    _registry()
    module = _module("PAGES")
    original = module.name
    detail = admin.get(f"{MODULES}{module.pk}/")

    @contextmanager
    def fail_after_the_write(*, using="default"):
        yield
        raise RuntimeError("audit context failed")

    monkeypatch.setattr("apps.sites.services.registry.database_audit_context", fail_after_the_write)
    with pytest.raises(RuntimeError, match="audit context failed"):
        admin.patch(
            f"{MODULES}{module.pk}/",
            {"name": "Rolled back"},
            content_type="application/json",
            HTTP_IF_MATCH=_etag(detail),
        )
    module.refresh_from_db()
    assert module.name == original


def test_template_patch_uses_the_same_autocommit_boundary(admin):
    _registry()
    listed = admin.get(TEMPLATES + "?code=COLLEGE")
    assert listed.status_code == 200
    template_id = listed.json()["results"][0]["id"]
    detail = admin.get(f"{TEMPLATES}{template_id}/")
    updated = admin.patch(
        f"{TEMPLATES}{template_id}/",
        {"name": "College template"},
        content_type="application/json",
        HTTP_IF_MATCH=_etag(detail),
    )
    assert updated.status_code == 200, updated.content
    assert SiteTemplate.objects.get(pk=template_id).name == "College template"
