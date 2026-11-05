"""Workspace navigation uses effective availability, not just the local switch."""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.sites.api.serializers import SiteModuleSerializer
from apps.sites.models import Module, Site, SiteModule
from tests.test_sites_api import admin, owner  # noqa: F401

pytestmark = pytest.mark.django_db


def test_global_disable_keeps_site_assignment_but_reports_unavailable(admin, owner):
    site = Site.objects.create(code="WORKSPACE", name="Workspace", organization_unit=owner)
    module = Module.objects.get(code="PAGES")
    module.is_enabled = True
    module.save()
    created = admin.post(f"/api/v1/sites/{site.pk}/modules/", {"module": module.pk}, content_type="application/json")
    assert created.status_code == 201, created.content
    assert created.json()["is_enabled"] is True
    assert created.json()["is_available"] is True
    module_url = f"/api/v1/modules/{module.pk}/"
    detail = admin.get(module_url)
    changed = admin.patch(module_url, {"is_enabled": False}, content_type="application/json", HTTP_IF_MATCH=detail["ETag"])
    assert changed.status_code == 200, changed.content
    detail = admin.get(created["Location"])
    assert detail.json()["is_enabled"] is True
    assert detail.json()["is_available"] is False
    rows = admin.get(f"/api/v1/sites/{site.pk}/modules/").json()["results"]
    assert len(rows) == 1 and rows[0]["is_available"] is False
    assert SiteModule.objects.get(pk=created.json()["id"]).is_enabled is True
    override = admin.patch(created["Location"], {"is_available": True}, content_type="application/json", HTTP_IF_MATCH=detail["ETag"])
    assert override.status_code == 400
    assert "is_available" in override.json()["error"]["details"]


def test_inventory_availability_has_constant_query_count(owner):
    site = Site.objects.create(code="WORKSPACE", name="Workspace", organization_unit=owner)
    for code in ("PAGES", "POSTS", "MENUS"):
        module = Module.objects.get(code=code)
        module.is_enabled = True
        module.save()
        SiteModule.objects.create(site=site, module=module)
    with CaptureQueriesContext(connection) as queries:
        rows = SiteModuleSerializer(SiteModule.objects.filter(site=site).select_related("module"), many=True).data
    assert len(rows) == 3 and all(row["is_available"] for row in rows)
    assert len(queries) == 2  # inventory plus one shared availability query
