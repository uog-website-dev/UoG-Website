"""Exercise the real bearer boundary, serialized writes and public contract."""
import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse

from apps.organizations.models import OrganizationType, OrganizationUnit

pytestmark = pytest.mark.django_db
BASE = "/api/v1/organizations/"


@pytest.fixture
def tree():
    for code in ["UNIVERSITY", "COLLEGE", "DEPARTMENT"]:
        OrganizationType.objects.get_or_create(code=code, defaults={"name": code.title()})
    root = OrganizationUnit.objects.create(code="UOG", name="University of Gondar", organization_type=OrganizationType.objects.get(code="UNIVERSITY"))
    college = OrganizationUnit.objects.create(code="COLLEGE", name="College", organization_type=OrganizationType.objects.get(code="COLLEGE"), parent=root)
    return root, college


@pytest.fixture
def admin(client, oidc, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    client.defaults.update(oidc.header())
    return client


def detail(unit):
    return reverse("organizations:organization-detail", args=[unit.pk])


@pytest.mark.parametrize("method,suffix", [("get", ""), ("post", ""), ("get", "1/"), ("patch", "1/"), ("post", "1/archive/"), ("post", "1/deactivate/")])
def test_anonymous_denied_before_validation(client, method, suffix):
    response = getattr(client, method)(BASE + suffix, content_type="application/json")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "not_authenticated"


@pytest.mark.parametrize("method,suffix", [("get", ""), ("post", ""), ("patch", "1/"), ("post", "1/archive/"), ("post", "1/deactivate/")])
def test_non_admin_token_denied(client, oidc, settings, method, suffix):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    response = getattr(client, method)(BASE + suffix, content_type="application/json", **oidc.header(realm_access={"roles": ["platform-viewer"]}))
    assert response.status_code == 403


def test_superuser_session_has_no_bearer_bypass(client):
    user = get_user_model().objects.create_user(username="local", is_staff=True, is_superuser=True)
    client.force_login(user)
    assert client.post(BASE, {}, content_type="application/json").status_code == 401


@pytest.mark.parametrize("debug,opt_in", [(False, False), (False, True), (True, False)])
@pytest.mark.parametrize("method,suffix", [("post", ""), ("patch", "1/"), ("post", "1/archive/"), ("post", "1/deactivate/")])
def test_write_gate_cannot_be_enabled_in_production(admin, settings, debug, opt_in, method, suffix):
    settings.DEBUG = debug
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = opt_in
    assert getattr(admin, method)(BASE + suffix, {}, content_type="application/json").status_code == 403


def test_list_pagination_and_explicit_fields(admin, tree):
    root, college = tree
    for index in range(20):
        OrganizationUnit.objects.create(code=f"UNIT{index:02}", name="Unit", organization_type=college.organization_type, parent=root)
    response = admin.get(BASE)
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 22
    assert len(body["results"]) == 20
    assert body["next"]
    assert len(admin.get(BASE + "?page=2").json()["results"]) == 2
    assert body["results"][0]["code"] == "COLLEGE"
    assert set(body["results"][0]) == {"id", "code", "name", "short_name", "organization_type", "parent", "description", "status", "metadata", "created_at", "updated_at"}
    assert admin.get(BASE + "?page=999").status_code == 404


def test_create_normalizes_code_duplicate_is_conflict(admin, tree):
    root, _ = tree
    data = {"code": " dept ", "name": "Department", "organization_type": "DEPARTMENT", "parent": root.pk, "metadata": {"optional": None}}
    response = admin.post(BASE, data, content_type="application/json")
    assert response.status_code == 201, response.content
    assert response.json()["code"] == "DEPT"
    assert response.json()["status"] == "ACTIVE"
    assert response.json()["metadata"] == {"optional": None}
    assert response["Location"] == BASE + str(response.json()["id"]) + "/"
    assert response["ETag"] == admin.get(response["Location"])["ETag"]
    duplicate = admin.post(BASE, data, content_type="application/json")
    assert duplicate.status_code == 409, duplicate.content
    assert duplicate.json()["error"]["code"] == "conflict"
    assert OrganizationUnit.objects.filter(code="DEPT").count() == 1


@pytest.mark.parametrize("data,field", [({}, "code"), ({"code": "BAD", "name": " ", "organization_type": "COLLEGE"}, "name"), ({"code": "BAD", "name": "Unit", "organization_type": "INVALID"}, "organization_type"), ({"code": "BAD", "name": "Unit", "organization_type": "COLLEGE", "parent": 999999}, "parent"), ({"status": "ARCHIVED"}, "status"), ({"domain": "example.com"}, "domain"), ({"metadata": []}, "metadata")])
def test_create_invalid_body_standardized(admin, data, field):
    response = admin.post(BASE, data, content_type="application/json")
    assert response.status_code == 400
    body = response.json()
    assert body["error"]["code"] == "validation_error"
    assert field in body["error"]["details"]
    assert body["request_id"] == response["X-Request-ID"]


def test_patch_preconditions_and_immutable_fields(admin, tree):
    _, college = tree
    url = detail(college)
    etag = admin.get(url)["ETag"]
    assert admin.patch(url, {"name": "New"}, content_type="application/json").status_code == 428
    for stale in ['"old"', "*", "W/" + etag]:
        assert admin.patch(url, {"name": "New"}, content_type="application/json", HTTP_IF_MATCH=stale).status_code == 412
    for field, value in [("code", "NEW"), ("id", 10), ("status", "INACTIVE"), ("theme", "x")]:
        assert admin.patch(url, {field: value}, content_type="application/json", HTTP_IF_MATCH=etag).status_code == 400
    updated = admin.patch(url, {"name": "New"}, content_type="application/json", HTTP_IF_MATCH=etag)
    assert updated.status_code == 200, updated.content
    assert updated["ETag"] != etag
    assert admin.patch(url, {"name": "Lost update"}, content_type="application/json", HTTP_IF_MATCH=etag).status_code == 412
    college.refresh_from_db()
    assert college.name == "New"


def test_lifecycle_retains_references_and_rejects_illegal_transitions(admin, tree):
    root, college = tree
    url = detail(college)
    etag = admin.get(url)["ETag"]
    assert admin.post(url + "archive/", {}, content_type="application/json", HTTP_IF_MATCH=etag).status_code == 400
    assert admin.post(url + "deactivate/", {}, content_type="application/json").status_code == 428
    inactive = admin.post(url + "deactivate/", {}, content_type="application/json", HTTP_IF_MATCH=etag)
    assert inactive.status_code == 200, inactive.content
    assert inactive.json()["status"] == "INACTIVE"
    archived = admin.post(url + "archive/", {}, content_type="application/json", HTTP_IF_MATCH=inactive["ETag"])
    assert archived.status_code == 200, archived.content
    assert archived.json()["status"] == "ARCHIVED"
    college.refresh_from_db()
    assert college.parent_id == root.pk
    assert admin.delete(url).status_code == 405
    assert admin.put(url, {}, content_type="application/json").status_code == 405
    assert admin.post(url + "deactivate/", {}, content_type="application/json", HTTP_IF_MATCH=archived["ETag"]).status_code == 400


def test_root_cycle_active_descendant_and_invalid_payload_denied(admin, tree):
    root, college = tree
    child = OrganizationUnit.objects.create(code="CHILD", name="Child", organization_type=college.organization_type, parent=college)
    for unit, parent in [(root, college.pk), (college, child.pk), (college, college.pk)]:
        url = detail(unit)
        assert admin.patch(url, {"parent": parent}, content_type="application/json", HTTP_IF_MATCH=admin.get(url)["ETag"]).status_code == 400
    for unit in [root, college]:
        url = detail(unit)
        assert admin.post(url + "deactivate/", {}, content_type="application/json", HTTP_IF_MATCH=admin.get(url)["ETag"]).status_code == 400
    url = detail(child)
    assert admin.post(url + "deactivate/", {"unexpected": True}, content_type="application/json", HTTP_IF_MATCH=admin.get(url)["ETag"]).status_code == 400
    assert admin.get(BASE + "999999/").status_code == 404
    assert admin.patch(BASE + "invalid-id/", {}, content_type="application/json", HTTP_IF_MATCH='"tag"').status_code == 404


def test_idempotency_not_silently_promised(admin):
    response = admin.post(BASE, {}, content_type="application/json", HTTP_IDEMPOTENCY_KEY="attempt-1")
    assert response.status_code == 400
    assert "Idempotency-Key" in response.json()["error"]["details"]


@pytest.mark.django_db(transaction=True)
def test_simultaneous_patch_same_etag_has_one_winner(admin, tree):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from django.db import close_old_connections, connections
    from django.test import Client

    _, college = tree
    url = detail(college)
    etag = admin.get(url)["ETag"]  # Provision the token principal before racing.
    auth = admin.defaults["HTTP_AUTHORIZATION"]
    barrier = Barrier(2)

    def update(name):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            response = Client().patch(url, {"name": name}, content_type="application/json", HTTP_AUTHORIZATION=auth, HTTP_IF_MATCH=etag)
            return response.status_code
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(update, name) for name in ["Winner A", "Winner B"]]
        statuses = [future.result(timeout=20) for future in futures]
    assert sorted(statuses) == [200, 412]
