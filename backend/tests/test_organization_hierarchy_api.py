"""Bounded, authorized hierarchy navigation without per-node queries."""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.organizations.api.views import OrganizationViewSet
from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.organizations.selectors.api_hierarchy import MAX_HIERARCHY_NODES

pytestmark = pytest.mark.django_db
BASE = "/api/v1/organizations/"
RELATIONS = ("children", "ancestors", "descendants", "subtree")


@pytest.fixture
def nodes():
    def create(code, type_code, parent=None):
        kind, _ = OrganizationType.objects.get_or_create(code=type_code, defaults={"name": type_code.title()})
        return OrganizationUnit.objects.create(code=code, name=code, organization_type=kind, parent=parent)
    root = create("UOG", "UNIVERSITY")
    college = create("CI", "COLLEGE", root)
    department = create("CS", "DEPARTMENT", college)
    sibling = create("CM", "COLLEGE", root)
    return root, college, department, sibling


@pytest.fixture
def admin(platform_admin_client):
    return platform_admin_client


def url(unit, relation):
    return f"{BASE}{unit.pk}/{relation}/"


def codes(response):
    assert response.status_code == 200, response.content
    body = response.json()
    assert set(body) == {"count", "results"}
    assert body["count"] == len(body["results"])
    return [unit["code"] for unit in body["results"]]


def test_tree_and_three_level_navigation_use_standard_representation(admin, nodes):
    root, college, department, sibling = nodes
    response = admin.get(BASE + "tree/")
    assert codes(response) == ["UOG", "CI", "CM", "CS"]
    assert response["Cache-Control"] == "private, no-store"
    assert response["X-Request-ID"]
    assert "ETag" not in response  # A multi-node response is not a mutation validator.
    for node in response.json()["results"]:
        assert node == admin.get(f"{BASE}{node['id']}/").json()
    assert codes(admin.get(url(root, "children"))) == ["CI", "CM"]
    assert codes(admin.get(url(college, "children"))) == ["CS"]
    assert codes(admin.get(url(department, "children"))) == []
    assert codes(admin.get(url(department, "ancestors"))) == ["UOG", "CI"]
    assert codes(admin.get(url(root, "ancestors"))) == []
    assert codes(admin.get(url(root, "descendants"))) == ["CI", "CM", "CS"]
    assert codes(admin.get(url(college, "descendants"))) == ["CS"]
    assert codes(admin.get(url(department, "descendants"))) == []
    assert codes(admin.get(url(college, "subtree"))) == ["CI", "CS"]
    assert codes(admin.get(url(department, "subtree"))) == ["CS"]


def test_all_lifecycle_states_preserve_structural_links(admin, nodes):
    root, college, department, sibling = nodes
    department.status = "INACTIVE"
    department.save()
    department.status = "ARCHIVED"
    department.save()
    college.status = "INACTIVE"
    college.save()
    response = admin.get(BASE + "tree/")
    assert codes(response) == ["UOG", "CI", "CM", "CS"]
    states = {node["code"]: node["status"] for node in response.json()["results"]}
    assert states == {"UOG": "ACTIVE", "CI": "INACTIVE", "CM": "ACTIVE", "CS": "ARCHIVED"}
    assert codes(admin.get(url(college, "descendants"))) == ["CS"]


@pytest.mark.parametrize("suffix", ["tree/", *[f"1/{relation}/" for relation in RELATIONS]])
def test_hierarchy_anonymous_and_viewer_denied(client, oidc, nodes, suffix):
    root, _college, _department, _sibling = nodes
    if suffix != "tree/":
        suffix = suffix.replace("1/", f"{root.pk}/", 1)
    assert client.get(BASE + suffix).status_code == 401
    response = client.get(BASE + suffix, **oidc.header(realm_access={"roles": ["platform-viewer"]}))
    assert response.status_code == 403


@pytest.mark.parametrize("relation", RELATIONS)
def test_missing_or_invalid_anchor_uses_standard_404(admin, relation):
    for identity in ["999999", "invalid"]:
        response = admin.get(f"{BASE}{identity}/{relation}/")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"
        assert response.json()["request_id"] == response["X-Request-ID"]


def test_empty_tree(admin):
    assert codes(admin.get(BASE + "tree/")) == []


def test_large_response_rejected_without_silent_truncation(admin, nodes, monkeypatch):
    # A smaller configured threshold exercises every boundary using real SQL.
    from apps.organizations.selectors import api_hierarchy
    assert MAX_HIERARCHY_NODES == 1000
    monkeypatch.setattr(api_hierarchy, "MAX_HIERARCHY_NODES", 2)
    monkeypatch.setattr("apps.organizations.api.views.MAX_HIERARCHY_NODES", 2)
    root, college, department, sibling = nodes
    for path in [BASE + "tree/", url(root, "descendants"), url(root, "subtree")]:
        response = admin.get(path)
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "conflict"
        assert response.json()["error"]["details"]["max_nodes"] == "2"
        assert "results" not in response.json()
    assert codes(admin.get(url(root, "children"))) == ["CI", "CM"]  # Exactly at cap.
    assert codes(admin.get(url(department, "ancestors"))) == ["UOG", "CI"]
    assert codes(admin.get(url(college, "subtree"))) == ["CI", "CS"]
    monkeypatch.setattr(api_hierarchy, "MAX_HIERARCHY_NODES", 1)
    for relation, anchor in [("children", root), ("ancestors", department)]:
        assert admin.get(url(anchor, relation)).status_code == 409


def test_authorized_queryset_controls_every_step_and_hides_boundary_parent(admin, nodes, monkeypatch):
    root, college, department, sibling = nodes
    # Simulate future row-level filtering without pretending scoped RBAC exists.
    monkeypatch.setattr(OrganizationViewSet, "get_queryset", lambda self: OrganizationUnit.objects.exclude(pk=college.pk))
    response = admin.get(BASE + "tree/")
    assert set(codes(response)) == {"UOG", "CM", "CS"}
    exposed = {item["id"]: item for item in response.json()["results"]}
    assert exposed[department.pk]["parent"] is None
    assert codes(admin.get(url(root, "descendants"))) == ["CM"]
    assert codes(admin.get(url(root, "children"))) == ["CM"]
    assert codes(admin.get(url(department, "ancestors"))) == []
    assert codes(admin.get(url(department, "subtree"))) == ["CS"]
    assert admin.get(url(college, "children")).status_code == 404


@pytest.mark.parametrize("relation", ["tree", *RELATIONS])
def test_query_count_does_not_grow_with_returned_nodes(admin, nodes, relation):
    root, college, department, sibling = nodes
    path = BASE + "tree/" if relation == "tree" else url(department if relation == "ancestors" else root, relation)
    admin.get(path)  # Provision the bearer principal before counting.
    with CaptureQueriesContext(connection) as small:
        assert admin.get(path).status_code == 200
    previous = department
    for index in range(25):
        previous = OrganizationUnit.objects.create(code=f"UNIT{index:02}", name="Unit", organization_type=department.organization_type, parent=previous if relation == "ancestors" else root)
    if relation == "ancestors":
        path = url(previous, relation)
    with CaptureQueriesContext(connection) as large:
        response = admin.get(path)
        assert response.status_code == 200
    assert len(large) == len(small), [query["sql"] for query in large]
    # No per-node OrganizationType lookups: hydration joins the lookup once.
    type_queries = [query for query in large if '"organizations_organizationtype"' in query["sql"]]
    assert len(type_queries) <= 2


def test_real_thousand_node_limit_and_large_navigation(admin, nodes):
    root, college, department, sibling = nodes
    OrganizationUnit.objects.bulk_create([
        OrganizationUnit(code=f"WIDE{index:04}", name="Wide unit", organization_type=department.organization_type, parent=root)
        for index in range(997)
    ])
    # 1001 total: no partial full tree; direct children and 1000 descendants fit.
    assert admin.get(BASE + "tree/").status_code == 409
    assert len(codes(admin.get(url(root, "children")))) == 999
    assert len(codes(admin.get(url(root, "descendants")))) == 1000
    assert admin.get(url(root, "subtree")).status_code == 409
