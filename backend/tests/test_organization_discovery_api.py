"""Discovery predicates, strict query validation and deterministic pagination."""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.organizations.api.views import OrganizationViewSet
from apps.organizations.models import OrganizationType, OrganizationUnit

pytestmark = pytest.mark.django_db
BASE = "/api/v1/organizations/"


@pytest.fixture
def units():
    def create(code, name, kind, parent=None):
        organization_type, _ = OrganizationType.objects.get_or_create(code=kind, defaults={"name": kind.title()})
        return OrganizationUnit.objects.create(code=code, name=name, organization_type=organization_type, parent=parent)
    root = create("UOG", "University of Gondar", "UNIVERSITY")
    college = create("CI", "College of Informatics", "COLLEGE", root)
    medicine = create("CM", "College of Medicine", "COLLEGE", root)
    old = create("OLD", "Former Informatics College", "COLLEGE", root)
    old.status = "INACTIVE"
    old.save()
    archived = create("ARCHIVED", "Historic Informatics College", "COLLEGE", root)
    archived.status = "INACTIVE"
    archived.save()
    archived.status = "ARCHIVED"
    archived.save()
    department = create("CS", "Computer Science", "DEPARTMENT", college)
    special = create("SPECIAL", "100%_Research ጥናት", "RESEARCH_CENTER", root)
    return {unit.code: unit for unit in [root, college, medicine, old, archived, department, special]}


@pytest.fixture
def admin(client, oidc):
    client.defaults.update(oidc.header())
    return client


def codes(response):
    assert response.status_code == 200, response.content
    return [unit["code"] for unit in response.json()["results"]]


@pytest.mark.parametrize("query,expected", [
    ({"search": "informatics"}, ["ARCHIVED", "CI", "OLD"]),
    ({"search": "cS"}, ["ARCHIVED", "CI", "CS", "OLD"]),
    ({"search": " uog "}, ["UOG"]),
    ({"search": ""}, ["ARCHIVED", "CI", "CM", "CS", "OLD", "SPECIAL", "UOG"]),
    ({"search": "    "}, ["ARCHIVED", "CI", "CM", "CS", "OLD", "SPECIAL", "UOG"]),
    ({"search": "%_"}, ["SPECIAL"]),
    ({"search": "ጥናት"}, ["SPECIAL"]),
    ({"search": "' OR 1=1 --"}, []),
    ({"name": "COLLEGE OF"}, ["CI", "CM"]),
    ({"code": " ci "}, ["CI"]),
    ({"code": "C"}, []),
    ({"type": "COLLEGE"}, ["ARCHIVED", "CI", "CM", "OLD"]),
    ({"status": "ACTIVE"}, ["CI", "CM", "CS", "SPECIAL", "UOG"]),
    ({"status": "INACTIVE"}, ["OLD"]),
    ({"status": "ARCHIVED"}, ["ARCHIVED"]),
    ({"parent": "null"}, ["UOG"]),
    ({"parent": "9223372036854775807"}, []),
    ({"search": "INFORMATICS", "name": "College", "code": "ci", "type": "COLLEGE", "status": "ACTIVE"}, ["CI"]),
])
def test_discovery_matches_database_values(admin, units, query, expected):
    assert codes(admin.get(BASE, query)) == expected


def test_combined_parent_filters(admin, units):
    root = units["UOG"]
    query = {"search": "informatics", "type": "COLLEGE", "status": "ACTIVE", "parent": root.pk}
    assert codes(admin.get(BASE, query)) == ["CI"]
    assert codes(admin.get(BASE, {"parent": units["CI"].pk})) == ["CS"]
    assert codes(admin.get(BASE, {**query, "parent": units["CI"].pk})) == []


def test_configurable_type_filter_uses_lookup_not_fixed_enum(admin, units):
    kind = OrganizationType.objects.create(code="CUSTOM_UNIT", name="Custom institutional unit")
    OrganizationUnit.objects.create(code="CUSTOM", name="Custom unit", organization_type=kind, parent=units["UOG"])
    assert codes(admin.get(BASE, {"type": "CUSTOM_UNIT"})) == ["CUSTOM"]


@pytest.mark.parametrize("query,field", [
    ({"type": "UNKNOWN"}, "type"), ({"type": "college"}, "type"),
    ({"status": "UNKNOWN"}, "status"), ({"status": "active"}, "status"),
    ({"parent": "0"}, "parent"), ({"parent": "-1"}, "parent"),
    ({"parent": "1.0"}, "parent"), ({"parent": "NULL"}, "parent"),
    ({"parent": "abc"}, "parent"), ({"parent": "١"}, "parent"),
    ({"parent": "9223372036854775808"}, "parent"),
    ({"code": "bad code"}, "code"), ({"name": " "}, "name"),
    ({"search": "x" * 256}, "search"), ({"code": "x" * 65}, "code"),
    ({"ordering": "metadata"}, "ordering"), ({"ordering": "organization_type__code"}, "ordering"),
    ({"ordering": "random()"}, "ordering"), ({"ordering": "code,-code"}, "ordering"),
    ({"ordering": "name,"}, "ordering"), ({"ordering": ""}, "ordering"),
    ({"status": ""}, "status"), ({"parent": ""}, "parent"),
    ({"type": ""}, "type"), ({"code": ""}, "code"),
    ({"page_size": "99999"}, "page_size"), ({"typo": "x"}, "typo"),
])
def test_invalid_parameters_return_standard_error(admin, query, field):
    response = admin.get(BASE, query)
    assert response.status_code == 400
    body = response.json()
    assert body["error"]["code"] == "validation_error"
    assert field in body["error"]["details"]
    assert body["request_id"] == response["X-Request-ID"]


@pytest.mark.parametrize("query,field", [("status=ACTIVE&status=ARCHIVED", "status"), ("search=a&search=b", "search"), ("page=1&page=2", "page")])
def test_repeated_parameters_rejected(admin, query, field):
    response = admin.get(BASE + "?" + query)
    assert response.status_code == 400
    assert field in response.json()["error"]["details"]


@pytest.mark.parametrize("ordering", ["code", "-code", "name", "-name", "created_at", "-created_at", "updated_at", "-updated_at", "name,-created_at"])
def test_approved_ordering_matches_database_and_unique_tiebreaker(admin, units, ordering):
    fields = ordering.split(",")
    if not any(field.removeprefix("-") == "code" for field in fields):
        fields.append("code")
    expected = list(OrganizationUnit.objects.order_by(*fields).values_list("code", flat=True))
    assert codes(admin.get(BASE, {"ordering": ordering})) == expected


def test_filtered_pagination_has_stable_ties_and_preserves_parameters(admin, units):
    root = units["UOG"]
    for index in range(25):
        OrganizationUnit.objects.create(code=f"PAGED_{index:02}", name="Same name", organization_type=units["CS"].organization_type, parent=root)
    query = {"search": "PAGED_", "name": "Same", "type": "DEPARTMENT", "status": "ACTIVE", "parent": root.pk, "ordering": "name"}
    first = admin.get(BASE, query)
    assert first.json()["count"] == 25
    assert codes(first) == [f"PAGED_{index:02}" for index in range(20)]
    second = admin.get(first.json()["next"])
    assert codes(second) == [f"PAGED_{index:02}" for index in range(20, 25)]
    assert "search=PAGED_" in second.json()["previous"]
    assert second.json()["next"] is None
    assert admin.get(BASE, {**query, "page": 999}).status_code == 404
    assert admin.get(BASE, {**query, "page": "invalid"}).status_code == 404


def test_discovery_never_widens_authorized_queryset_or_changes_hierarchy(admin, units, monkeypatch):
    hidden = units["CI"]
    monkeypatch.setattr(OrganizationViewSet, "get_queryset", lambda self: OrganizationUnit.objects.exclude(pk=hidden.pk).select_related("organization_type"))
    assert codes(admin.get(BASE, {"code": "CI"})) == []
    assert codes(admin.get(BASE, {"search": "informatics", "status": "ACTIVE"})) == []
    # List filters do not alter ancestry, hide inactive nodes or sort the tree.
    tree = admin.get(BASE + "tree/?status=ACTIVE&search=nonexistent&ordering=-code")
    assert tree.status_code == 200
    assert {unit["code"] for unit in tree.json()["results"]} == {"UOG", "CM", "CS", "OLD", "ARCHIVED", "SPECIAL"}
    assert admin.get(BASE + f"{units['CS'].pk}/?search=nonexistent").status_code == 200


def test_discovery_permissions_precede_parameter_validation(client, oidc):
    assert client.get(BASE, {"status": "INVALID"}).status_code == 401
    assert client.get(BASE, {"status": "INVALID"}, **oidc.header(realm_access={"roles": ["platform-viewer"]})).status_code == 403


def test_discovery_uses_sql_pagination_and_no_per_node_type_queries(admin, units):
    root = units["UOG"]
    query = {"type": "DEPARTMENT", "status": "ACTIVE", "parent": root.pk, "search": "BENCH", "ordering": "name"}
    admin.get(BASE, query)
    with CaptureQueriesContext(connection) as small:
        assert admin.get(BASE, query).status_code == 200
    for index in range(30):
        OrganizationUnit.objects.create(code=f"BENCH_{index:02}", name="Discovery benchmark", organization_type=units["CS"].organization_type, parent=root)
    with CaptureQueriesContext(connection) as large:
        response = admin.get(BASE, query)
        assert len(codes(response)) == 20
    # Empty results skip the page SELECT; a populated page adds one query only.
    assert len(large) <= len(small) + 1
    sql = [query["sql"] for query in large]
    page_queries = [query for query in sql if '"organizations_organizationunit"' in query and 'LIMIT 20' in query]
    assert len(page_queries) == 1
    assert 'UPPER(' in page_queries[0]
    assert 'LIKE' in page_queries[0]
    assert 'ORDER BY' in page_queries[0]
