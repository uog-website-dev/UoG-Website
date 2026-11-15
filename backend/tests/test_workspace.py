"""PERF-002 live authorization, minimal contract and bounded bootstrap queries."""
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.authorization.models import Permission, Role, UserRoleAssignment
from apps.authorization.services import effective_permission_sets, permission_granted
from apps.sites.models import Module, Site
from apps.sites.services.modules import enable_module_for_site
from tests.test_authorization import organization_tree

pytestmark = pytest.mark.django_db


@pytest.fixture
def world():
    call_command("seed_rbac", verbosity=0)
    _, owner = organization_tree()
    a = Site.objects.create(organization_unit=owner, code="WORK-A", name="Same name")
    b = Site.objects.create(organization_unit=owner, code="WORK-B", name="Same name")
    actor = get_user_model().objects.create_user(username="workspace-member")
    role = Role.objects.get(code="site-administrator")
    assignment = UserRoleAssignment.objects.create(user=actor, role=role, scope="SITE", site=a, organization=owner)
    client = APIClient()
    client.force_authenticate(actor)
    return client, actor, a, b, assignment


def test_minimal_context_no_site_enumeration_and_bounded_queries(world):
    client, actor, a, b, _ = world
    with patch("apps.sites.api.workspace.authorized_site_ids", side_effect=AssertionError("Discovery on critical path")):
        with CaptureQueriesContext(connection) as queries:
            response = client.get(f"/api/workspace/?site={a.pk}")
    assert response.status_code == 200, response.data
    assert len(queries) <= 12, [q["sql"] for q in queries]
    body = response.json()
    assert set(body) == {"schemaVersion", "version", "platformPermissions", "site"}
    assert body["schemaVersion"] == 1 and len(body["version"]) == 64
    assert body["platformPermissions"] == []
    assert body["site"]["id"] == a.pk and body["site"]["organization"] == {"id": a.organization_unit_id, "name": "College"}
    assert "content.pages.update" in body["site"]["permissions"]
    assert response["Cache-Control"] == "private, no-store"
    again = client.get(f"/api/workspace/?site={a.pk}", HTTP_IF_NONE_MATCH=response["ETag"])
    assert again.status_code == 200 and again["ETag"] == response["ETag"]
    assert client.get("/api/workspace/").json()["site"] is None


def test_foreign_unknown_anonymous_and_ambiguous_context(world):
    client, _, a, b, _ = world
    foreign = client.get(f"/api/workspace/?site={b.pk}")
    missing = client.get("/api/workspace/?site=99999999")
    assert foreign.status_code == missing.status_code == 404
    # Per-request correlation IDs remain distinct; the denial itself is identical.
    assert foreign.json()["error"] == missing.json()["error"]
    assert APIClient().get(f"/api/workspace/?site={a.pk}").status_code == 401
    for query in ["site=0", "site=", "site=abc", "site=1&site=2", "site=9007199254740992", "organization=1"]:
        assert client.get("/api/workspace/?" + query).status_code == 400


@pytest.mark.parametrize("change", ["revoked", "expired", "role_disabled", "user_disabled"])
def test_live_access_removal_is_not_restored_by_etag(world, change):
    client, actor, a, _, assignment = world
    initial = client.get(f"/api/workspace/?site={a.pk}")
    if change == "revoked":
        UserRoleAssignment.objects.filter(pk=assignment.pk).update(revoked_at=timezone.now())
    elif change == "expired":
        UserRoleAssignment.objects.filter(pk=assignment.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
    elif change == "role_disabled":
        Role.objects.filter(pk=assignment.role_id).update(is_active=False)
    else:
        actor.is_active = False
        actor.save(update_fields=["is_active"])
    result = client.get(f"/api/workspace/?site={a.pk}", HTTP_IF_NONE_MATCH=initial["ETag"])
    assert result.status_code == 404 and "site" not in result.data


def test_switcher_paging_search_and_isolation(world):
    client, actor, a, b, assignment = world
    assert client.get("/api/workspace/sites/").json()["results"] == [{"id": a.pk, "name": a.name, "code": a.code, "status": a.status}]
    assert client.get("/api/workspace/sites/?search=WORK-B").json()["count"] == 0
    UserRoleAssignment.objects.create(user=actor, role=assignment.role, scope="SITE", site=b, organization=b.organization_unit)
    first = client.get("/api/workspace/sites/?page_size=1").json()
    second = client.get("/api/workspace/sites/?page_size=1&page=2").json()
    assert first["count"] == 2 and first["results"][0]["id"] != second["results"][0]["id"]
    assert client.get("/api/workspace/sites/?search=WORK-B").json()["results"][0]["id"] == b.pk
    for query in ["page=0", "page_size=51", "page=1&page=2", "search=" + "x" * 101, "site=1"]:
        assert client.get("/api/workspace/sites/?" + query).status_code == 400


def test_module_changes_update_version_and_use_canonical_dependencies(world):
    client, _, a, _, _ = world
    module, _ = Module.objects.get_or_create(code="PAGES", defaults={
        "name": "Pages", "description": "Shipped fixture", "status": "IMPLEMENTED",
    })
    with connection.cursor() as cursor:
        cursor.execute("INSERT INTO sites_module_implementation (code) VALUES ('PAGES') ON CONFLICT DO NOTHING")
    module.is_enabled = True
    module.save(update_fields=["is_enabled"])
    enable_module_for_site(a.pk, module.pk)
    before = client.get(f"/api/workspace/?site={a.pk}")
    assert "PAGES" in before.json()["site"]["enabledModuleCodes"]
    module.is_enabled = False
    module.save(update_fields=["is_enabled"])
    after = client.get(f"/api/workspace/?site={a.pk}")
    assert "PAGES" not in after.json()["site"]["enabledModuleCodes"]
    assert after["ETag"] != before["ETag"]


def test_disabled_permission_removes_bootstrap_and_discovery_access(world):
    client, _, a, _, _ = world
    initial = client.get(f"/api/workspace/?site={a.pk}")
    Permission.objects.filter(code="sites.view").update(is_active=False)
    assert client.get(f"/api/workspace/?site={a.pk}", HTTP_IF_NONE_MATCH=initial["ETag"]).status_code == 404
    assert client.get("/api/workspace/sites/").json()["results"] == []


@pytest.mark.parametrize("scope", ["SITE", "ORGANIZATION", "PLATFORM"])
def test_bulk_discovery_matches_canonical_permission_decisions(world, scope):
    _, actor, a, b, assignment = world
    if scope != "SITE":
        UserRoleAssignment.objects.filter(pk=assignment.pk).update(scope=scope, site=None,
            organization=assignment.organization if scope == "ORGANIZATION" else None)
    scopes = [(None, None), (a.organization_unit_id, a.pk), (b.organization_unit_id, b.pk)]
    snapshot = effective_permission_sets(actor, scopes)
    registered = list(Permission.objects.filter(is_active=True, is_system=True).values_list("code", flat=True))
    for (org, site), actual in zip(scopes, snapshot):
        expected = sorted(code for code in registered if permission_granted(actor, code, organization_id=org, site_id=site, audit=False))
        assert actual == expected
