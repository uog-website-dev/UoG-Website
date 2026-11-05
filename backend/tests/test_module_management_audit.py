"""Regression coverage for the central management story audit."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, close_old_connections, connections, transaction

from apps.audit.models import AuditEvent
from apps.sites.models import Module, ModuleDependency, SiteModule, SiteModuleOperation
from apps.sites.selectors.modules import available_module_codes
from apps.sites.services import module_bulk
from apps.sites.services.modules import enable_module_for_site, disable_module_for_site
from tests.test_central_module_management import (
    world, _apply, _preview, _selected, _enable_posts_globally, APPLY, PREVIEW, MATRIX,
)

pytestmark = pytest.mark.django_db(transaction=True)


def test_completed_operation_replays_after_preview_expiry_without_duplicate_changes(world, monkeypatch):
    _enable_posts_globally()
    body = _preview(world.admin, "ENABLE", ["POSTS"], _selected(world.sites.informatics))
    key = uuid.uuid4()
    first = _apply(world.admin, body["preview_token"], key=key)
    changed_events = AuditEvent.objects.filter(action="SITE_MODULE_ENABLED").count()
    monkeypatch.setattr(module_bulk, "PREVIEW_MAX_AGE_SECONDS", -1)
    replay = _apply(world.admin, body["preview_token"], key=key, status=200)
    assert replay["replayed"] and replay["operation"]["id"] == first["operation"]["id"]
    assert SiteModuleOperation.objects.count() == 1
    assert AuditEvent.objects.filter(action="SITE_MODULE_ENABLED").count() == changed_events
    assert _apply(world.admin, body["preview_token"], status=409)["error"]["details"]["reason"] == "preview_expired"


@pytest.mark.parametrize("change", ["site", "dependency", "schema"])
def test_preview_binds_versions_and_dependencies_even_if_eligibility_is_unchanged(world, change):
    _enable_posts_globally()
    body = _preview(world.admin, "ENABLE", ["POSTS"], _selected(world.sites.informatics))
    posts = Module.objects.get(code="POSTS")
    if change == "site":
        world.sites.informatics.refresh_from_db()
        world.sites.informatics.name = "Renamed college Site"
        world.sites.informatics.save()
    elif change == "dependency":
        ModuleDependency.objects.create(module=posts, requires=Module.objects.get(code="PAGES"))
    else:
        posts.configuration_schema = {"schema_version": 1, "properties": [{"code": "SHOW_DATE", "label": "Show date", "type": "boolean", "required": False}]}
        posts.save()
    rejected = _apply(world.admin, body["preview_token"], status=409)
    assert rejected["error"]["details"]["reason"] == "stale_preview"
    assert not SiteModule.objects.filter(module=posts).exists()


def test_invalid_retained_settings_are_blocked_in_preview(world):
    _enable_posts_globally()
    posts = Module.objects.get(code="POSTS")
    row = enable_module_for_site(world.sites.informatics.pk, posts.pk)
    disable_module_for_site(row.site_id, posts.pk)
    posts.configuration_schema = {"schema_version": 1, "properties": [{"code": "SHOW_DATE", "label": "Show date", "type": "boolean", "required": True}]}
    posts.save()
    body = _preview(world.admin, "ENABLE", ["POSTS"], _selected(world.sites.informatics))
    assert body["summary"]["expected_changes"] == 0
    assert body["sites"][0]["modules"][0]["reasons"][0]["code"] == "configuration_invalid"


def test_dependency_cycles_are_rejected_by_model_and_database(world):
    posts, menus = Module.objects.get(code="POSTS"), Module.objects.get(code="MENUS")
    ModuleDependency.objects.create(module=posts, requires=menus)
    with pytest.raises(ValidationError, match="cycles"):
        ModuleDependency.objects.create(module=menus, requires=posts)
    with pytest.raises(IntegrityError), transaction.atomic():
        ModuleDependency.objects.bulk_create([ModuleDependency(module=menus, requires=posts)])


def test_database_rejects_bypassed_dependency_and_archived_switches(world):
    _enable_posts_globally()
    posts, pages = Module.objects.get(code="POSTS"), Module.objects.get(code="PAGES")
    ModuleDependency.objects.create(module=posts, requires=pages)
    enable_module_for_site(world.sites.informatics.pk, posts.pk)
    with pytest.raises(IntegrityError), transaction.atomic():
        SiteModule.objects.filter(site=world.sites.informatics, module=pages).update(is_enabled=False)
    with pytest.raises(IntegrityError), transaction.atomic():
        SiteModule.objects.bulk_create([SiteModule(site=world.sites.archived, module=pages)])
    assert SiteModule.objects.get(site=world.sites.informatics, module=pages).is_enabled


def test_simultaneous_individual_switches_cannot_break_dependency(world):
    _enable_posts_globally()
    posts, pages = Module.objects.get(code="POSTS"), Module.objects.get(code="PAGES")
    ModuleDependency.objects.create(module=posts, requires=pages)
    barrier = Barrier(2)

    def attempt(command, module):
        close_old_connections()
        try:
            with connections["default"].cursor() as cursor:
                cursor.execute("SET lock_timeout = '10s'")
            barrier.wait(timeout=10)
            try:
                command(world.sites.informatics.pk, module.pk)
                return "committed"
            except ValidationError:
                return "rejected"
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(attempt, enable_module_for_site, posts)
        second = executor.submit(attempt, disable_module_for_site, pages)
        assert sorted([first.result(timeout=30), second.result(timeout=30)]) == ["committed", "rejected"]
    assert not (SiteModule.objects.filter(site=world.sites.informatics, module=posts, is_enabled=True).exists()
                and not SiteModule.objects.get(site=world.sites.informatics, module=pages).is_enabled)


def test_global_dependency_switch_removes_effective_availability_without_destroying_state(world):
    _enable_posts_globally()
    posts, pages = Module.objects.get(code="POSTS"), Module.objects.get(code="PAGES")
    ModuleDependency.objects.create(module=posts, requires=pages)
    enable_module_for_site(world.sites.informatics.pk, posts.pk)
    assert "POSTS" in available_module_codes(world.sites.informatics.pk)


    pages.is_enabled = False
    pages.save()
    assert "POSTS" not in available_module_codes(world.sites.informatics.pk)
    assert SiteModule.objects.get(site=world.sites.informatics, module=posts).is_enabled
    pages.is_enabled = True
    pages.save()
    assert "POSTS" in available_module_codes(world.sites.informatics.pk)


def test_activation_summary_counts_dependency_eligible_sites(world):
    _enable_posts_globally()
    posts, pages = Module.objects.get(code="POSTS"), Module.objects.get(code="PAGES")
    ModuleDependency.objects.create(module=posts, requires=pages)
    SiteModule.objects.filter(site=world.sites.medicine, module=pages).update(is_enabled=False)
    rows = {row["code"]: row for row in world.admin.get("/api/v1/modules/activation-summary/").json()}
    assert rows["POSTS"]["eligible_sites"] == 3


def test_domain_service_audits_switches_once_and_refuses_site_admin_bulk_access(world):
    _enable_posts_globally()
    posts = Module.objects.get(code="POSTS")
    enable_module_for_site(world.sites.informatics.pk, posts.pk)
    enable_module_for_site(world.sites.informatics.pk, posts.pk)
    assert AuditEvent.objects.filter(action="SITE_MODULE_ENABLED", entity_id=f"{world.sites.informatics.pk}:POSTS").count() == 1
    user = get_user_model().objects.get(username="cmm-site-admin")
    with pytest.raises(module_bulk.BulkOperationError) as error:
        module_bulk.preview(user, action="ENABLE", module_codes=["POSTS"], scope=_selected(world.sites.medicine))
    assert error.value.status == 403


def test_invalid_requests_and_scope_fields_are_rejected_and_audited_without_raw_payload(world):
    for scope in ({"type": "ALL", "site_ids": [world.sites.informatics.pk]}, {"type": "FILTER", "filters": {"typo": "ignored?"}}):
        response = world.admin.post(PREVIEW, {"action": "ENABLE", "modules": ["PAGES"], "scope": scope}, content_type="application/json")
        assert response.status_code == 400, response.content
    invalid = world.admin.post(APPLY, {"preview_token": "must-not-enter-audit"}, content_type="application/json")
    assert invalid.status_code == 400
    for query in ("module=UNKNOWN", "include_descendants=maybe", "status=ACTIVE&status=DRAFT"):
        assert world.admin.get(MATRIX + "?" + query).status_code == 400
    rejected = AuditEvent.objects.filter(action="SITE_MODULE_BULK_REJECTED")
    assert rejected.count() >= 6
    assert "must-not-enter-audit" not in str(list(rejected.values("after")))
