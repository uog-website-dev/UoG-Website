"""Primary hostname summaries avoid a request/query for every Site row."""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.sites.api.serializers import SiteSerializer
from apps.sites.api.views import SiteViewSet
from apps.sites.models import Site
from tests.test_sites_api import admin, owner  # noqa: F401

pytestmark = pytest.mark.django_db


def test_site_inventory_includes_primary_hostname_and_null_without_one(admin, owner):
    first = Site.objects.create(code="FIRST", name="First", organization_unit=owner)
    second = Site.objects.create(code="SECOND", name="Second", organization_unit=owner)
    base = f"/api/v1/sites/{first.pk}/"
    created = admin.post(base + "domains/", {"hostname": "first.uog.local", "status": "ACTIVE"}, content_type="application/json")
    assert created.status_code == 201, created.content
    selected = admin.post(created["Location"] + "set-primary/", {}, content_type="application/json", HTTP_IF_MATCH=created["ETag"])
    assert selected.status_code == 200, selected.content
    rows = admin.get("/api/v1/sites/").json()["results"]
    summaries = {row["id"]: row["primary_domain"] for row in rows}
    assert summaries[first.pk] == {"hostname": "first.uog.local", "status": "ACTIVE"}
    assert summaries[second.pk] is None
    detail = admin.get(base)
    assert detail.json()["primary_domain"] == summaries[first.pk]
    rejected = admin.patch(base, {"primary_domain": {"hostname": "injected.uog.local"}}, content_type="application/json", HTTP_IF_MATCH=detail["ETag"])
    assert rejected.status_code == 400
    assert "primary_domain" in rejected.json()["error"]["details"]


def test_primary_hostname_serialization_uses_two_queries_for_multiple_sites(owner):
    sites = [Site.objects.create(code=f"SITE{i}", name=f"Site {i}", organization_unit=owner) for i in range(4)]
    with CaptureQueriesContext(connection) as queries:
        rows = SiteSerializer(SiteViewSet.queryset.filter(pk__in=[site.pk for site in sites]), many=True).data
    assert len(rows) == 4 and all(row["primary_domain"] is None for row in rows)
    assert len(queries) == 2  # Site page and one bounded primary-domain prefetch
