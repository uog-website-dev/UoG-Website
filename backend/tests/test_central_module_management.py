"""Central module management across Sites, exercised over authenticated HTTP.

These tests run with autocommit on, so locks, the all-or-nothing transaction
and committed history behave as they do in a deployed request.
"""
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, close_old_connections, connections, transaction
from django.test import Client

from apps.api.models import Post
from apps.audit.models import AuditEvent
from apps.authorization.models import Role, UserRoleAssignment
from apps.cms.tests.support import transition_with_site_role
from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.sites.models import (
    Module, ModuleDependency, Site, SiteDomain, SiteModule, SiteModuleOperation, SiteModuleOperationChange,
)
from apps.sites.module_schema import empty_module_schema
from apps.sites.services.lifecycle import activate_site, archive_site

pytestmark = pytest.mark.django_db(transaction=True)

SUMMARY = "/api/v1/modules/activation-summary/"
MATRIX = "/api/v1/site-modules/"
PREVIEW = "/api/v1/site-modules/bulk-preview/"
APPLY = "/api/v1/site-modules/bulk-apply/"
OPERATIONS = "/api/v1/site-modules/operations/"
PUBLIC_POSTS = "/api/v1/site-context/posts/"


def _registry():
    with connections["default"].cursor() as cursor:
        cursor.execute(
            "INSERT INTO sites_module_implementation (code) VALUES ('PAGES'), ('POSTS'), ('MENUS') ON CONFLICT (code) DO NOTHING"
        )
    for code in ("PAGES", "POSTS", "MENUS"):
        Module.objects.get_or_create(code=code, defaults={
            "name": code.title(), "description": f"{code} capability.", "status": Module.Status.IMPLEMENTED,
            "is_enabled": False, "configuration_schema": empty_module_schema(),
        })
    Module.objects.get_or_create(code="EVENTS", defaults={
        "name": "Events", "description": "Planned.", "status": Module.Status.PLANNED,
        "is_enabled": False, "configuration_schema": empty_module_schema(),
    })
    Module.objects.exclude(code__in=["PAGES", "POSTS", "MENUS", "MEDIA"]).update(status=Module.Status.PLANNED, is_enabled=False)
    Module.objects.filter(code="POSTS").update(is_enabled=False)
    Module.objects.filter(code__in=["PAGES", "MENUS"]).update(status=Module.Status.IMPLEMENTED, is_enabled=True)


def _site(owner, code, *, active=True):
    site = Site.objects.create(organization_unit=owner, code=code, name=f"{code.title()} Site")
    if active:
        activate_site(site.pk)
    SiteDomain.objects.create(site=site, hostname=f"{code.lower()}.uog.edu.et", is_primary=True, status=SiteDomain.Status.ACTIVE)
    return site


@pytest.fixture
def world(platform_admin_client, oidc, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    settings.ALLOWED_HOSTS = ["*"]
    settings.CACHES = {"default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "KEY_PREFIX": settings.CACHE_KEY_PREFIX, "KEY_FUNCTION": "apps.core.cache.make_cache_key",
    }}
    _registry()
    university, _ = OrganizationType.objects.get_or_create(code="UNIVERSITY", defaults={"name": "University"})
    college, _ = OrganizationType.objects.get_or_create(code="COLLEGE", defaults={"name": "College"})
    department, _ = OrganizationType.objects.get_or_create(code="DEPARTMENT", defaults={"name": "Department"})
    root = OrganizationUnit.objects.create(code="CMM-UOG", name="University", organization_type=university)
    informatics = OrganizationUnit.objects.create(code="CMM-CI", name="Informatics", organization_type=college, parent=root)
    computing = OrganizationUnit.objects.create(code="CMM-CS", name="Computer Science", organization_type=department, parent=informatics)
    medicine = OrganizationUnit.objects.create(code="CMM-CM", name="Medicine", organization_type=college, parent=root)
    sites = SimpleNamespace(
        main=_site(root, "CMM-MAIN"), informatics=_site(informatics, "CMM-INF"),
        computing=_site(computing, "CMM-CS"), medicine=_site(medicine, "CMM-MED"),
        archived=_site(informatics, "CMM-OLD"),
    )
    archive_site(sites.archived.pk)
    for site in (sites.main, sites.informatics, sites.computing, sites.medicine):
        SiteModule.objects.create(site=site, module=Module.objects.get(code="PAGES"))

    site_admin = Client()
    claims = {"sub": "5f1b2c3d-0000-4000-8000-0000000000aa", "preferred_username": "cmm-site-admin", "email": "cmm-site-admin@uog.et"}
    site_admin.defaults.update(oidc.header(**claims))
    assert site_admin.get("/api/me/").status_code == 200
    UserRoleAssignment.objects.create(
        user=get_user_model().objects.get(username="cmm-site-admin"), role=Role.objects.get(code="site-administrator"),
        scope=UserRoleAssignment.Scope.SITE, organization=informatics, site=sites.informatics,
    )
    return SimpleNamespace(admin=platform_admin_client, site_admin=site_admin, sites=sites,
                           orgs=SimpleNamespace(root=root, informatics=informatics, computing=computing, medicine=medicine))


def _enable_posts_globally():
    Module.objects.filter(code="POSTS").update(is_enabled=True)


def _preview(client, action, modules, scope, status=200):
    response = client.post(PREVIEW, {"action": action, "modules": modules, "scope": scope}, content_type="application/json")
    assert response.status_code == status, response.content
    return response.json()


def _apply(client, token, *, key=None, reason="", confirmation="", status=201):
    response = client.post(
        APPLY, {"preview_token": token, "reason": reason, "confirmation": confirmation},
        content_type="application/json", HTTP_IDEMPOTENCY_KEY=str(key or uuid.uuid4()),
    )
    assert response.status_code == status, response.content
    return response.json()


def _state(site, code):
    row = SiteModule.objects.filter(site=site, module__code=code).first()
    return None if row is None else row.is_enabled


def _selected(*sites):
    return {"type": "SELECTED", "site_ids": [site.pk for site in sites]}


# Registry and matrix -------------------------------------------------------------

def test_activation_summary_separates_implementation_availability_and_activation(world):
    _enable_posts_globally()
    Module.objects.create(code="LEGACY", name="Legacy", description="Old.", status=Module.Status.DEPRECATED,
                          is_enabled=False, configuration_schema=empty_module_schema())
    ModuleDependency.objects.create(module=Module.objects.get(code="MENUS"), requires=Module.objects.get(code="PAGES"))
    Module.objects.filter(code="POSTS").update(is_enabled=False)
    response = world.admin.get(SUMMARY)
    assert response.status_code == 200, response.content
    rows = {row["code"]: row for row in response.json()}
    assert rows["PAGES"]["implementation_status"] == "AVAILABLE"
    assert rows["PAGES"]["enabled_sites"] == 4 and rows["PAGES"]["eligible_sites"] == 4 and rows["PAGES"]["total_sites"] == 5
    assert rows["PAGES"]["required_by"] == ["MENUS"] and rows["MENUS"]["requires"] == ["PAGES"]
    assert rows["POSTS"]["implementation_status"] == "IMPLEMENTED_DISABLED" and rows["POSTS"]["eligible_sites"] == 0
    assert rows["EVENTS"]["implementation_status"] == "PLANNED" and rows["EVENTS"]["platform_enabled"] is False
    assert rows["LEGACY"]["implementation_status"] == "DEPRECATED"


def test_site_matrix_filters_by_organization_status_and_activation(world):
    listed = world.admin.get(MATRIX, {"organization": world.orgs.informatics.pk})
    assert listed.status_code == 200, listed.content
    assert {row["code"] for row in listed.json()["results"]} == {"CMM-INF", "CMM-OLD"}
    nested = world.admin.get(MATRIX, {"organization": world.orgs.informatics.pk, "include_descendants": "true", "status": "ACTIVE"})
    assert {row["code"] for row in nested.json()["results"]} == {"CMM-INF", "CMM-CS"}
    absent = world.admin.get(MATRIX, {"module": "PAGES", "activation": "NOT_ASSIGNED"})
    assert [row["code"] for row in absent.json()["results"]] == ["CMM-OLD"]
    enabled = world.admin.get(MATRIX, {"module": "pages", "activation": "ENABLED", "search": "med"})
    assert [row["code"] for row in enabled.json()["results"]] == ["CMM-MED"]
    assert enabled.json()["results"][0]["modules"] == {"PAGES": "ENABLED"}
    assert world.admin.get(MATRIX, {"activation": "ENABLED"}).status_code == 400
    assert world.admin.get(MATRIX, {"unknown": "1"}).status_code == 400


# Preview and eligibility ------------------------------------------------------------

def test_preview_reports_counts_reasons_and_writes_nothing(world):
    body = _preview(world.admin, "ENABLE", ["POSTS", "PAGES"], _selected(world.sites.informatics, world.sites.medicine, world.sites.archived))
    summary = body["summary"]
    assert summary["matched_sites"] == 3
    assert summary["blocked_sites"] == 3
    assert summary["expected_changes"] == 0
    assert {reason["code"] for reason in summary["blocked_reasons"]} == {"module_platform_disabled", "site_archived"}
    _enable_posts_globally()
    body = _preview(world.admin, "ENABLE", ["POSTS", "PAGES"], _selected(world.sites.informatics, world.sites.medicine, world.sites.archived))
    summary = body["summary"]
    assert (summary["eligible_sites"], summary["blocked_sites"], summary["expected_changes"]) == (2, 1, 2)
    by_site = {site["code"]: site for site in body["sites"]}
    assert by_site["CMM-INF"]["outcome"] == "CHANGE"
    assert {m["code"]: m["outcome"] for m in by_site["CMM-INF"]["modules"]} == {"PAGES": "UNCHANGED", "POSTS": "CHANGE"}
    assert by_site["CMM-OLD"]["outcome"] == "BLOCKED"
    assert body["preview_token"] and body["high_impact"] is False
    assert _state(world.sites.informatics, "POSTS") is None
    assert not SiteModuleOperation.objects.exists()


def test_preview_blocks_planned_deprecated_and_unknown_modules(world):
    planned = _preview(world.admin, "ENABLE", ["EVENTS"], {"type": "ALL"})
    assert planned["summary"]["blocked_reasons"][0]["code"] == "module_planned"
    assert planned["high_impact"] is True
    Module.objects.filter(code="MENUS").update(status=Module.Status.DEPRECATED, is_enabled=False)
    deprecated = _preview(world.admin, "ENABLE", ["MENUS"], _selected(world.sites.main))
    assert deprecated["summary"]["blocked_reasons"][0]["code"] == "module_deprecated"
    unknown = _preview(world.admin, "ENABLE", ["NOPE"], _selected(world.sites.main), status=400)
    assert unknown["error"]["details"]["reason"] == "module_not_found"
    missing = _preview(world.admin, "ENABLE", ["PAGES"], {"type": "SELECTED", "site_ids": [999999]}, status=400)
    assert missing["error"]["details"]["reason"] == "unknown_sites"
    assert _preview(world.admin, "ENABLE", ["PAGES"], {"type": "SITE", "site_ids": [1, 2]}, status=400)
    assert _preview(world.admin, "ENABLE", ["PAGES"], {"type": "ORGANIZATION"}, status=400)


def test_organization_scope_direct_versus_descendants(world):
    _enable_posts_globally()
    direct = _preview(world.admin, "ENABLE", ["POSTS"], {"type": "ORGANIZATION", "organization": world.orgs.informatics.pk})
    assert {site["code"] for site in direct["sites"]} == {"CMM-INF", "CMM-OLD"}
    nested = _preview(world.admin, "ENABLE", ["POSTS"], {"type": "ORGANIZATION", "organization": world.orgs.informatics.pk, "include_descendants": True})
    assert {site["code"] for site in nested["sites"]} == {"CMM-INF", "CMM-OLD", "CMM-CS"}
    assert nested["summary"]["eligible_sites"] == 2 and nested["summary"]["blocked_sites"] == 1
    _apply(world.admin, nested["preview_token"])
    assert _state(world.sites.computing, "POSTS") is True and _state(world.sites.informatics, "POSTS") is True
    assert _state(world.sites.medicine, "POSTS") is None and _state(world.sites.archived, "POSTS") is None


def test_filter_scope_targets_all_matching_sites_not_just_a_page(world):
    _enable_posts_globally()
    body = _preview(world.admin, "ENABLE", ["POSTS"], {"type": "FILTER", "filters": {"status": "ACTIVE", "module": "PAGES", "activation": "ENABLED"}})
    assert body["summary"]["matched_sites"] == 4 and body["high_impact"] is True
    rejected = _apply(world.admin, body["preview_token"], status=400)
    assert rejected["error"]["details"]["reason"] == "reason_required"
    rejected = _apply(world.admin, body["preview_token"], reason="Faculty news rollout", confirmation="yes", status=400)
    assert rejected["error"]["details"]["reason"] == "confirmation_required"
    assert not SiteModule.objects.filter(module__code="POSTS").exists()
    applied = _apply(world.admin, body["preview_token"], reason="Faculty news rollout", confirmation="enable")
    assert applied["operation"]["change_count"] == 4
    assert SiteModule.objects.filter(module__code="POSTS", is_enabled=True).count() == 4


# Apply semantics ----------------------------------------------------------------------

def test_apply_is_idempotent_and_rejects_reused_keys_and_stale_previews(world):
    _enable_posts_globally()
    body = _preview(world.admin, "ENABLE", ["POSTS"], _selected(world.sites.informatics, world.sites.medicine))
    key = uuid.uuid4()
    first = _apply(world.admin, body["preview_token"], key=key, reason="Pilot")
    assert first["replayed"] is False and first["operation"]["change_count"] == 2
    again = _apply(world.admin, body["preview_token"], key=key, reason="Pilot", status=200)
    assert again["replayed"] is True and again["operation"]["id"] == first["operation"]["id"]
    assert SiteModuleOperation.objects.count() == 1 and SiteModuleOperationChange.objects.count() == 2
    reused = _apply(world.admin, body["preview_token"], key=key, reason="Different", status=409)
    assert reused["error"]["details"]["reason"] == "idempotency_key_reused"
    stale = _apply(world.admin, body["preview_token"], status=409)
    assert stale["error"]["details"]["reason"] == "stale_preview"
    assert stale["error"]["details"]["summary"]["already_in_state_sites"] == 2
    assert SiteModuleOperation.objects.count() == 1
    assert world.admin.post(APPLY, {"preview_token": body["preview_token"]}, content_type="application/json").status_code == 400
    assert _apply(world.admin, "tampered", status=400)["error"]["details"]["reason"] == "invalid_preview"


def test_change_after_preview_is_rejected_and_nothing_is_written(world):
    _enable_posts_globally()
    body = _preview(world.admin, "ENABLE", ["POSTS"], _selected(world.sites.informatics, world.sites.medicine))
    archive_site(world.sites.medicine.pk)
    stale = _apply(world.admin, body["preview_token"], status=409)
    assert stale["error"]["details"]["reason"] == "stale_preview"
    assert not SiteModule.objects.filter(module__code="POSTS").exists()
    assert AuditEvent.objects.filter(action="SITE_MODULE_BULK_REJECTED", after__reason="stale_preview").exists()


def test_failure_mid_operation_rolls_every_change_back(world, monkeypatch):
    _enable_posts_globally()
    body = _preview(world.admin, "ENABLE", ["POSTS"], _selected(world.sites.informatics, world.sites.medicine))
    from apps.sites.services import module_bulk
    original, calls = module_bulk.record_site_module_change, []

    def fail_on_second(*args, **kwargs):
        calls.append(args)
        if len(calls) == 2:
            raise IntegrityError("simulated failure")
        return original(*args, **kwargs)

    monkeypatch.setattr(module_bulk, "record_site_module_change", fail_on_second)
    with pytest.raises(IntegrityError):
        world.admin.post(APPLY, {"preview_token": body["preview_token"]}, content_type="application/json",
                         HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()))
    assert not SiteModule.objects.filter(module__code="POSTS").exists()
    assert not SiteModuleOperation.objects.exists() and not SiteModuleOperationChange.objects.exists()
    assert not AuditEvent.objects.filter(action__in=["SITE_MODULE_ENABLED", "SITE_MODULE_BULK_APPLIED"]).exists()


def test_concurrent_applies_of_one_preview_commit_once(world):
    _enable_posts_globally()
    body = _preview(world.admin, "ENABLE", ["POSTS"], _selected(world.sites.informatics, world.sites.medicine))
    token = world.admin.defaults["HTTP_AUTHORIZATION"]
    barrier = Barrier(3)

    def attempt():
        close_old_connections()
        try:
            with connections["default"].cursor() as cursor:
                cursor.execute("SET lock_timeout = '10s'")
            barrier.wait(timeout=10)
            return Client().post(APPLY, {"preview_token": body["preview_token"]}, content_type="application/json",
                                 HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()), HTTP_AUTHORIZATION=token).status_code
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(attempt) for _ in range(2)]
        barrier.wait(timeout=10)
        statuses = sorted(future.result(timeout=30) for future in futures)
    assert statuses == [201, 409]
    assert SiteModuleOperation.objects.count() == 1
    assert SiteModule.objects.filter(module__code="POSTS", is_enabled=True).count() == 2


def test_history_is_append_only(world):
    _enable_posts_globally()
    _apply(world.admin, _preview(world.admin, "ENABLE", ["POSTS"], _selected(world.sites.main))["preview_token"])
    operation = SiteModuleOperation.objects.get()
    with pytest.raises(Exception, match="append-only"), transaction.atomic():
        SiteModuleOperation.objects.filter(pk=operation.pk).update(reason="rewritten")
    with pytest.raises(Exception, match="append-only"), transaction.atomic():
        SiteModuleOperationChange.objects.filter(operation=operation).delete()


# Dependencies ---------------------------------------------------------------------------

def test_dependencies_block_activation_and_disable_without_cascading(world):
    _enable_posts_globally()
    pages, posts = Module.objects.get(code="PAGES"), Module.objects.get(code="POSTS")
    ModuleDependency.objects.create(module=posts, requires=pages)
    SiteModule.objects.filter(site=world.sites.medicine, module=pages).update(is_enabled=False)

    body = _preview(world.admin, "ENABLE", ["POSTS"], _selected(world.sites.informatics, world.sites.medicine))
    by_site = {site["code"]: site for site in body["sites"]}
    assert by_site["CMM-INF"]["outcome"] == "CHANGE"
    assert by_site["CMM-MED"]["modules"][0]["reasons"][0] == {
        "code": "missing_dependency", "module": "PAGES",
        "message": "A required module is not enabled for this Site and is not part of this operation.",
    }
    assert body["dependency_warnings"][0]["message"] == "POSTS requires PAGES on each Site."

    together = _preview(world.admin, "ENABLE", ["POSTS", "PAGES"], _selected(world.sites.medicine))
    assert together["summary"]["expected_changes"] == 2 and together["summary"]["blocked_sites"] == 0
    _apply(world.admin, together["preview_token"])
    assert _state(world.sites.medicine, "PAGES") is True and _state(world.sites.medicine, "POSTS") is True

    blocked = _preview(world.admin, "DISABLE", ["PAGES"], _selected(world.sites.medicine))
    assert blocked["sites"][0]["modules"][0]["reasons"][0]["code"] == "required_by"
    _apply(world.admin, blocked["preview_token"])
    assert _state(world.sites.medicine, "PAGES") is True and _state(world.sites.medicine, "POSTS") is True

    both = _preview(world.admin, "DISABLE", ["PAGES", "POSTS"], _selected(world.sites.medicine))
    assert both["summary"]["expected_changes"] == 2
    _apply(world.admin, both["preview_token"])
    assert _state(world.sites.medicine, "PAGES") is False and _state(world.sites.medicine, "POSTS") is False


def test_single_site_switch_uses_the_same_dependency_rule_and_audit(world):
    _enable_posts_globally()
    pages, posts = Module.objects.get(code="PAGES"), Module.objects.get(code="POSTS")
    ModuleDependency.objects.create(module=posts, requires=pages)
    url = f"/api/v1/sites/{world.sites.informatics.pk}/modules/"
    created = world.admin.post(url, {"module": posts.pk, "configuration": {}}, content_type="application/json")
    assert created.status_code == 201, created.content
    pages_row = SiteModule.objects.get(site=world.sites.informatics, module=pages)
    detail = world.admin.get(f"{url}{pages_row.pk}/")
    refused = world.admin.post(f"{url}{pages_row.pk}/disable/", {}, content_type="application/json", HTTP_IF_MATCH=detail["ETag"])
    assert refused.status_code == 400, refused.content
    assert "POSTS requires PAGES" in str(refused.json()["error"]["details"])
    assert _state(world.sites.informatics, "PAGES") is True
    event = AuditEvent.objects.get(action="SITE_MODULE_ENABLED", entity_id=f"{world.sites.informatics.pk}:POSTS")
    assert event.before["state"] == "not_assigned" and event.after["state"] == "enabled" and event.after["scope"] == "SITE"


# Authorization and write gate -------------------------------------------------------------

def test_site_admins_and_anonymous_callers_cannot_use_central_management(world, client):
    _enable_posts_globally()
    token = _preview(world.admin, "ENABLE", ["POSTS"], _selected(world.sites.informatics))["preview_token"]
    for method, url, data in (
        ("get", SUMMARY, None), ("get", MATRIX, None), ("get", OPERATIONS, None),
        ("post", PREVIEW, {"action": "ENABLE", "modules": ["POSTS"], "scope": _selected(world.sites.informatics)}),
        ("post", APPLY, {"preview_token": token}),
    ):
        kwargs = {"content_type": "application/json", "HTTP_IDEMPOTENCY_KEY": str(uuid.uuid4())} if method == "post" else {}
        denied = getattr(world.site_admin, method)(url, data, **kwargs)
        assert denied.status_code == 403, (url, denied.content)
        anonymous = getattr(Client(), method)(url, data, **kwargs)
        assert anonymous.status_code == 401, (url, anonymous.content)
    assert _state(world.sites.informatics, "POSTS") is None
    assert AuditEvent.objects.filter(action="SITE_MODULE_BULK_REJECTED", after__reason="permission_denied").exists()


def test_central_apply_uses_platform_permission_in_production(world, settings):
    _enable_posts_globally()
    settings.DEBUG = False
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = False
    body = _preview(world.admin, "ENABLE", ["POSTS"], _selected(world.sites.informatics))
    assert body["summary"]["expected_changes"] == 1
    _apply(world.admin, body["preview_token"])
    assert _state(world.sites.informatics, "POSTS") is True
    _preview(world.site_admin, "DISABLE", ["POSTS"], _selected(world.sites.informatics), status=403)
    _apply(world.site_admin, body["preview_token"], status=403)
    assert _state(world.sites.informatics, "POSTS") is True


# End to end ---------------------------------------------------------------------------------

def _publish(post):
    for action in ("submit", "approve", "publish"):
        transition_with_site_role(post, action, get_user_model().objects.create_user(username=f"cmm-{action}-{post.pk}"))
    post.refresh_from_db()
    return post


def test_posts_rollout_disable_and_restore_keep_content(world):
    inf, med, main = world.sites.informatics, world.sites.medicine, world.sites.main
    _enable_posts_globally()

    rollout = _preview(world.admin, "ENABLE", ["POSTS"], _selected(inf, med))
    assert rollout["summary"]["expected_changes"] == 2
    enabled = _apply(world.admin, rollout["preview_token"], reason="Faculty news pilot")
    operation_id = enabled["operation"]["id"]
    assert {(c["site_code"], c["module"], c["previous_state"], c["new_state"]) for c in enabled["operation"]["changes"]} == {
        ("CMM-INF", "POSTS", "NOT_ASSIGNED", "ENABLED"), ("CMM-MED", "POSTS", "NOT_ASSIGNED", "ENABLED"),
    }

    for site in (inf, med):
        modules = world.admin.get(f"/api/v1/sites/{site.pk}/modules/").json()["results"]
        assert {row["module_code"]: row["is_enabled"] for row in modules}["POSTS"] is True
    unselected = world.admin.post(f"/api/v1/sites/{main.pk}/posts/", {"title": "No", "slug": "no", "content": "No"}, content_type="application/json")
    assert unselected.status_code == 400, unselected.content
    assert not Post.objects.filter(site=main).exists()

    created = world.admin.post(f"/api/v1/sites/{inf.pk}/posts/", {"title": "Hackathon", "slug": "hackathon", "content": "Kept"}, content_type="application/json")
    assert created.status_code == 201, created.content
    post = _publish(Post.objects.get(pk=created.json()["id"]))
    host = {"HTTP_HOST": "cmm-inf.uog.edu.et"}
    assert world.admin.get(f"{PUBLIC_POSTS}hackathon/", **host).status_code == 200

    shutdown = _preview(world.admin, "DISABLE", ["POSTS"], _selected(inf, med))
    assert shutdown["high_impact"] is True
    _apply(world.admin, shutdown["preview_token"], reason="Content review", confirmation="DISABLE")
    assert _state(inf, "POSTS") is False and _state(med, "POSTS") is False
    blocked = world.admin.post(f"/api/v1/sites/{inf.pk}/posts/", {"title": "Later", "slug": "later", "content": "No"}, content_type="application/json")
    assert blocked.status_code == 400, blocked.content
    assert not Post.objects.filter(site=inf, slug="later").exists()
    assert world.admin.get(f"{PUBLIC_POSTS}hackathon/", **host).status_code == 404
    assert world.admin.get(PUBLIC_POSTS, **host).status_code == 404
    assert Post.objects.filter(pk=post.pk, title="Hackathon", content="Kept").exists()

    restore = _preview(world.admin, "ENABLE", ["POSTS"], _selected(inf))
    _apply(world.admin, restore["preview_token"], reason="Review complete")
    restored = world.admin.get(f"{PUBLIC_POSTS}hackathon/", **host)
    assert restored.status_code == 200 and restored.json()["content"] == "Kept"

    history = world.admin.get(OPERATIONS, {"module": "posts"}).json()
    assert [row["action"] for row in history["results"]] == ["ENABLE", "DISABLE", "ENABLE"]
    assert history["results"][-1]["actor"]["username"] == "devuser"
    assert world.admin.get(OPERATIONS, {"site": med.pk}).json()["count"] == 2
    detail = world.admin.get(f"{OPERATIONS}{operation_id}/")
    assert detail.status_code == 200 and detail.json()["reason"] == "Faculty news pilot"
    assert world.admin.get(f"{OPERATIONS}not-a-uuid/").status_code == 404

    events = AuditEvent.objects.filter(entity_type="sites.sitemodule", entity_id=f"{inf.pk}:POSTS").order_by("timestamp")
    assert [event.after["state"] for event in events] == ["enabled", "disabled", "enabled"]
    first = events.first()
    assert first.actor_kind == "USER" and first.after["operation_id"] == operation_id
    assert first.after["reason"] == "Faculty news pilot" and first.after["scope"] == "SELECTED" and first.request_id
    assert AuditEvent.objects.filter(action="SITE_MODULE_BULK_APPLIED", entity_id=operation_id).exists()

    denied = world.site_admin.post(PREVIEW, {"action": "DISABLE", "modules": ["POSTS"], "scope": _selected(inf)}, content_type="application/json")
    assert denied.status_code == 403
