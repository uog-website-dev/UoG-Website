"""PERF-006 real DB aggregates, live authorization and bounded cache behavior."""
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.core.cache import cache
from django.db import DatabaseError, connection, transaction
from django.contrib.auth import get_user_model
from apps.sites.models import Site
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.api.models import Post
from apps.authorization.models import Role, UserRoleAssignment
from apps.cms.models import Page
from apps.cms.menu_models import Menu, MenuItem
from apps.media.models import MediaAsset
from apps.media.services import asset_write
from apps.sites.models import Module, SiteModule
from apps.sites.services.modules import enable_module_for_site
from apps.core.dashboard import aggregate_section
from .test_workspace import world  # existing two-Site fixture

pytestmark = pytest.mark.django_db


@pytest.fixture
def dashboard(world):
    client, actor, a, b, assignment = world
    cache.clear()
    for code in ("PAGES", "POSTS", "MENUS", "MEDIA"):
        module, _ = Module.objects.get_or_create(code=code, defaults={"name": code, "description": "Dashboard test implementation", "status": "IMPLEMENTED", "is_enabled": True})
        Module.objects.filter(pk=module.pk).update(is_enabled=True, status="IMPLEMENTED")
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO sites_module_implementation (code) VALUES (%s) ON CONFLICT DO NOTHING", [code])
        enable_module_for_site(a.pk, module.pk)
    for i in range(2):
        Page.objects.create(site=a, title=f"Page {i}", slug=f"page-{i}", created_by=actor, updated_by=actor)
    Post.objects.create(site=a, title="News", slug="news", author=actor, content="<p>Fixture article</p>", created_by=actor, updated_by=actor)
    Post.objects.create(site=b, title="Foreign private news", slug="news", author=actor, content="<p>Fixture article</p>", created_by=actor, updated_by=actor)
    menu = Menu.objects.create(site=a, name="Local navigation", code="local")
    MenuItem.objects.create(site=a, menu=menu, label="Information", item_type="custom", target="/information", sort_order=0)
    with asset_write(actor, a.pk, "content.media.upload"):
        MediaAsset.objects.create(site=a, storage_reference=f"platform-private:sites/{a.pk}/fixture.jpg", original_filename="fixture.jpg", detected_mime="image/jpeg", byte_count=10, checksum="a" * 64, created_by=actor, updated_by=actor)
    return client, actor, a, b, assignment


def summary(client, site):
    return client.get(f"/api/workspace/dashboard/?site={site.pk}")


def test_counts_match_sources_without_loading_records(dashboard):
    client, _, site, _, _ = dashboard
    with CaptureQueriesContext(connection) as queries:
        response = summary(client, site)
    assert response.status_code == 200, response.data
    sections = response.json()["sections"]
    assert sections["pages"]["counts"] == {"total": 2, "DRAFT": 2, "IN_REVIEW": 0, "APPROVED": 0, "PUBLISHED": 0, "UNPUBLISHED": 0, "ARCHIVED": 0}
    assert sections["posts"]["counts"]["total"] == 1
    assert sections["menus"]["counts"] == {"total": 1, "active": 1, "items": 1}
    assert sections["media"]["counts"]["total"] == 1
    assert sections["users"]["counts"]["total"] == 1
    assert len(queries) <= 32, [row["sql"] for row in queries]
    assert not any('"blocks"' in row["sql"] or '"profile_picture"' in row["sql"] for row in queries)
    assert response["Cache-Control"] == "private, no-store"
    assert "Foreign private news" not in response.content.decode()


def test_cached_aggregates_still_check_live_scope_and_modules(dashboard):
    client, _, a, _, _ = dashboard
    assert summary(client, a).json()["cache"]["hit"] is False
    with patch("apps.core.dashboard.aggregate_section", side_effect=AssertionError("Cached aggregate reran")):
        assert summary(client, a).json()["cache"]["hit"] is True
        SiteModule.objects.filter(site=a, module__code="POSTS").update(is_enabled=False)
        # Changed module fingerprint is a cache miss, so allow other counts.
    result = summary(client, a)
    assert "posts" not in result.json()["sections"]


@pytest.mark.parametrize("change", ["revoked", "expired", "role_disabled", "user_disabled"])
def test_cached_counts_do_not_survive_access_removal(dashboard, change):
    client, actor, a, _, assignment = dashboard
    assert summary(client, a).status_code == 200
    if change == "revoked":
        UserRoleAssignment.objects.filter(pk=assignment.pk).update(revoked_at=timezone.now())
    elif change == "expired":
        UserRoleAssignment.objects.filter(pk=assignment.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
    elif change == "role_disabled":
        Role.objects.filter(pk=assignment.role_id).update(is_active=False)
    else:
        actor.is_active = False
        actor.save(update_fields=["is_active"])
    assert summary(client, a).status_code == 404


def test_foreign_unknown_anonymous_and_query_validation(dashboard):
    client, _, a, b, _ = dashboard
    assert summary(client, b).status_code == client.get("/api/workspace/dashboard/?site=99999999").status_code == 404
    assert summary(APIClient(), a).status_code == 401
    for query in ("", "site=0", "site=x", "site=1&site=2", "site=1&organization=2"):
        assert client.get("/api/workspace/dashboard/?" + query).status_code == 400


def test_commit_invalidates_without_repopulating_obsolete_generation(dashboard, django_capture_on_commit_callbacks):
    client, actor, a, _, _ = dashboard
    before = summary(client, a).json()
    with django_capture_on_commit_callbacks(execute=True):
        Post.objects.create(site=a, title="New draft", slug="new-draft", author=actor, content="<p>Fixture article</p>", created_by=actor, updated_by=actor)
    after = summary(client, a).json()
    assert after["cache"]["hit"] is False
    assert before["sections"]["posts"]["counts"]["total"] == 1
    assert after["sections"]["posts"]["counts"]["total"] == 2


def test_redis_failure_and_one_failed_aggregate_do_not_blank_other_counts(dashboard):
    client, _, a, _, _ = dashboard
    def load(kind, site):
        if kind == "posts":
            raise DatabaseError("Injected query failure")
        return aggregate_section(kind, site)
    with patch("apps.core.dashboard.dashboard_cache.cache_key", side_effect=ConnectionError("Redis unavailable")), patch("apps.core.dashboard.aggregate_section", side_effect=load):
        body = summary(client, a).json()
    assert body["cache"]["available"] is False and body["partial"] is True
    assert body["sections"]["posts"] == {"status": "unavailable"}
    assert body["sections"]["pages"]["counts"]["total"] == 2
    assert "Injected" not in str(body)


def test_activity_is_separate_bounded_and_scoped(dashboard):
    client, _, a, _, _ = dashboard
    response = client.get(f"/api/workspace/dashboard/activity/?site={a.pk}")
    assert response.status_code == 200
    body = response.json()
    assert len(body["results"]) == 3
    assert all(set(row) == {"id", "kind", "title", "status", "updated_at"} for row in body["results"])
    assert "Foreign private news" not in response.content.decode()
    SiteModule.objects.filter(site=a, module__code="POSTS").update(is_enabled=False)
    assert all(row["kind"] == "pages" for row in client.get(f"/api/workspace/dashboard/activity/?site={a.pk}").json()["results"])


def test_custom_capability_role_cannot_bypass_cms_read_policy(dashboard):
    client, _, a, _, assignment = dashboard
    role = Role.objects.create(code="summary-custom", name="Custom reader")
    for link in assignment.role.permission_links.filter(permission__code__in=["sites.view", "content.posts.view"]):
        role.permission_links.create(permission=link.permission)
    assignment.role = role
    assignment.save()
    assert "posts" not in summary(client, a).json()["sections"]


def test_zero_content_site_and_duplicate_membership_roles(dashboard, django_capture_on_commit_callbacks):
    client, actor, a, b, _ = dashboard
    with django_capture_on_commit_callbacks(execute=True):
        UserRoleAssignment.objects.create(user=actor, role=Role.objects.get(code="editor"), site=a, organization=a.organization_unit, scope="SITE")
        UserRoleAssignment.objects.create(user=actor, role=Role.objects.get(code="site-administrator"), site=b, organization=b.organization_unit, scope="SITE")
    assert summary(client, a).json()["sections"]["users"]["counts"]["total"] == 1
    # No enabled modules on B: no CMS count is disclosed; the active member is visible.
    assert set(summary(client, b).json()["sections"]) == {"users"}


def test_zero_enabled_site_and_personal_cache_partition(dashboard):
    client, actor, a, _, _ = dashboard
    summary(client, a)
    other = get_user_model().objects.create_user(username="another-dashboard-admin")
    UserRoleAssignment.objects.create(user=other, role=Role.objects.get(code="site-administrator"), site=a, organization=a.organization_unit, scope="SITE")
    second = APIClient()
    second.force_authenticate(other)
    assert summary(second, a).json()["cache"]["hit"] is False
    empty = Site.objects.create(code="SUMMARYEMPTY", name="Empty", organization_unit=a.organization_unit)
    UserRoleAssignment.objects.create(user=actor, role=Role.objects.get(code="site-administrator"), site=empty, organization=empty.organization_unit, scope="SITE")
    enable_module_for_site(empty.pk, Module.objects.get(code="PAGES").pk)
    assert all(value == 0 for value in summary(client, empty).json()["sections"]["pages"]["counts"].values())


def test_rollback_does_not_invalidate_and_ttl_is_explicit(dashboard):
    client, actor, a, _, _ = dashboard
    before = summary(client, a).json()
    with transaction.atomic():
        Post.objects.create(site=a, title="Rolled back", slug="rolled-back", content="<p>Draft</p>", author=actor, created_by=actor, updated_by=actor)
        transaction.set_rollback(True)
    after = summary(client, a).json()
    assert after["cache"]["hit"] is True
    assert after["generated_at"] == before["generated_at"]
    assert (timezone.datetime.fromisoformat(after["expires_at"]) - timezone.datetime.fromisoformat(after["generated_at"])).total_seconds() == after["cache"]["ttl_seconds"] == 15


def test_partial_results_are_never_cached(dashboard):
    client, _, a, _, _ = dashboard
    def failed(kind, site):
        if kind == "posts":
            raise DatabaseError("Temporary")
        return aggregate_section(kind, site)
    with patch("apps.core.dashboard.aggregate_section", side_effect=failed):
        assert summary(client, a).json()["partial"] is True
    normal = summary(client, a).json()
    assert normal["partial"] is False and normal["cache"]["hit"] is False
    assert normal["sections"]["posts"]["counts"]["total"] == 1
