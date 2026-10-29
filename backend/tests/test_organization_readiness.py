"""Cross-feature acceptance scenario: real DB, restricted API, domain and audit."""
from collections import Counter
import json
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.db.migrations.recorder import MigrationRecorder

from apps.audit.models import AuditEvent
from apps.organizations.models import OrganizationType, OrganizationUnit

pytestmark = pytest.mark.django_db
BASE = "/api/v1/organizations/"
MANIFEST = Path(__file__).parent / "fixtures" / "organizations" / "uog-structure.json"


@pytest.fixture
def representative_structure(platform_admin_client, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    settings.API_DOCS_ENABLED = True
    correlation_id = str(uuid4())
    client = platform_admin_client
    client.defaults.update(HTTP_X_REQUEST_ID=correlation_id, REMOTE_ADDR="198.51.100.42")
    manifest = json.loads(MANIFEST.read_text())
    assert manifest["schema_version"] == 1
    units = {}
    for entry in manifest["units"]:
        data = {key: value for key, value in entry.items() if key != "parent_code"}
        data["parent"] = units[entry["parent_code"]]["id"] if entry["parent_code"] else None
        response = client.post(BASE, data, content_type="application/json")
        assert response.status_code == 201, response.content
        assert response["X-Request-ID"] == correlation_id
        units[entry["code"]] = response.json()
    return client, units, correlation_id


def unit_url(unit):
    return f"{BASE}{unit['id']}/"


def mutate(client, unit, data=None, action=None):
    url = unit_url(unit)
    etag = client.get(url)["ETag"]
    method = client.post if action else client.patch
    return method(url + f"{action}/" if action else url, data or {}, content_type="application/json", HTTP_IF_MATCH=etag)


def codes(response):
    assert response.status_code == 200, response.content
    return [item["code"] for item in response.json()["results"]]


def test_clean_migration_graph_and_required_lookup_seeds():
    assert connection.vendor == "postgresql"
    applied = MigrationRecorder(connection).applied_migrations()
    assert ("organizations", "0006_audit_events") in applied
    assert ("audit", "0002_common_writer") in applied
    assert set(OrganizationType.objects.values_list("code", flat=True)) == {
        "UNIVERSITY", "COLLEGE", "SCHOOL", "INSTITUTE", "DEPARTMENT", "RESEARCH_CENTER",
        "DIRECTORATE", "OFFICE", "ADMINISTRATIVE_UNIT", "OTHER",
    }
    assert not OrganizationUnit.objects.exists()


def test_representative_uog_backend_acceptance_workflow(representative_structure):
    client, units, request_id = representative_structure
    root, college, department, information_systems = [units[code] for code in ["UOG", "CI", "CS", "IS"]]
    assert OrganizationUnit.objects.count() == 8
    assert OrganizationUnit.objects.filter(parent__isnull=True, organization_type__code="UNIVERSITY").count() == 1
    assert units["RC"]["organization_type"] == "RESEARCH_CENTER"
    assert units["LIBRARY"]["organization_type"] == "DIRECTORATE"
    assert units["REGISTRAR"]["organization_type"] == "ADMINISTRATIVE_UNIT"
    assert codes(client.get(BASE)) == ["CI", "CM", "CS", "IS", "LIBRARY", "RC", "REGISTRAR", "UOG"]
    assert client.get(unit_url(department)).json()["parent"] == college["id"]
    assert codes(client.get(BASE + "tree/")) == ["UOG", "CI", "CM", "LIBRARY", "RC", "REGISTRAR", "CS", "IS"]
    assert codes(client.get(unit_url(college) + "children/")) == ["CS", "IS"]
    assert codes(client.get(unit_url(department) + "ancestors/")) == ["UOG", "CI"]
    assert codes(client.get(unit_url(college) + "descendants/")) == ["CS", "IS"]
    assert codes(client.get(unit_url(college) + "subtree/")) == ["CI", "CS", "IS"]
    assert codes(client.get(BASE, {"search": "informatics", "type": "COLLEGE", "status": "ACTIVE", "parent": root["id"], "ordering": "name"})) == ["CI"]
    assert codes(client.get(BASE, {"search": "cs"})) == ["CI", "CS"]
    assert codes(client.get(BASE, {"parent": "null"})) == ["UOG"]

    # Both HTTP validation and PostgreSQL enforce normalized code uniqueness.
    duplicate = client.post(BASE, {"code": " ci ", "name": "Duplicate", "organization_type": "COLLEGE", "parent": root["id"]}, content_type="application/json")
    assert duplicate.status_code == 409
    with pytest.raises(IntegrityError), transaction.atomic():
        OrganizationUnit.objects.bulk_create([OrganizationUnit(code="CI", name="Duplicate", organization_type_id=OrganizationUnit.objects.get(pk=college["id"]).organization_type_id, parent_id=root["id"])])
    assert OrganizationUnit.objects.count() == 8
    assert AuditEvent.objects.count() == 8

    # Rejected structures and lifecycle attempts must not leave audit successes.
    for unit, parent in [(college, department["id"]), (department, department["id"]), (root, college["id"])]:
        invalid = mutate(client, unit, {"parent": parent})
        assert invalid.status_code == 400
        assert invalid.json()["request_id"] == request_id
    assert mutate(client, root, action="deactivate").status_code == 400
    assert mutate(client, college, action="archive").status_code == 400
    assert mutate(client, college, action="deactivate").status_code == 400
    assert AuditEvent.objects.count() == 8

    old_etag = client.get(unit_url(department))["ETag"]
    updated = mutate(client, department, {"short_name": "CS", "metadata": {"validation_fixture": True, "password": "must-not-enter-audit"}})
    assert updated.status_code == 200
    assert updated["ETag"] != old_etag
    stale = client.patch(unit_url(department), {"name": "Lost update"}, content_type="application/json", HTTP_IF_MATCH=old_etag)
    assert stale.status_code == 412
    assert client.get(unit_url(department)).json()["name"] == "Computer Science"

    assert mutate(client, information_systems, {"parent": units["CM"]["id"]}).status_code == 200
    assert codes(client.get(unit_url(information_systems) + "ancestors/")) == ["UOG", "CM"]
    assert mutate(client, information_systems, {"parent": college["id"]}).status_code == 200

    # A real FK consumer models a future Site's historical reference, not Site implementation.
    with connection.cursor() as cursor:
        # PostgreSQL disallows temporary -> permanent table FKs. This ordinary
        # test-database table is removed by pytest's outer transaction rollback.
        cursor.execute("CREATE TABLE readiness_reference (organization_unit_id bigint NOT NULL REFERENCES organizations_organizationunit(id) ON DELETE RESTRICT)")
        cursor.execute("INSERT INTO readiness_reference VALUES (%s)", [college["id"]])
    for unit in [department, information_systems, college]:
        assert mutate(client, unit, action="deactivate").status_code == 200
    assert mutate(client, college, action="archive").status_code == 200
    assert mutate(client, department, action="archive").status_code == 200
    assert client.get(unit_url(root)).json()["status"] == "ACTIVE"
    assert client.get(unit_url(information_systems)).json()["status"] == "INACTIVE"
    assert client.delete(unit_url(college)).status_code == 403  # unsupported methods fail closed before method dispatch
    with pytest.raises(IntegrityError), transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("DELETE FROM organizations_organizationunit WHERE id=%s", [college["id"]])
    with connection.cursor() as cursor:
        cursor.execute("SELECT organization_unit_id FROM readiness_reference")
        assert cursor.fetchone()[0] == college["id"]
    assert OrganizationUnit.objects.count() == 8
    assert set(codes(client.get(BASE + "tree/"))) == set(units)
    assert codes(client.get(BASE, {"status": "ARCHIVED", "ordering": "code"})) == ["CI", "CS"]

    records = list(AuditEvent.objects.order_by("id"))
    assert Counter(record.action for record in records) == {
        "ORGANIZATION_CREATED": 8, "ORGANIZATION_UPDATED": 1, "ORGANIZATION_MOVED": 2,
        "ORGANIZATION_DEACTIVATED": 3, "ORGANIZATION_ARCHIVED": 2,
    }
    user_id = str(get_user_model().objects.get(username="devuser").pk)
    assert all(record.actor_kind == "USER" and record.actor_id == user_id for record in records)
    assert all(record.request_id == UUID(request_id) and record.ip == "198.51.100.42" for record in records)
    assert all(record.entity_type == "organizations.organizationunit" and record.after["id"] == int(record.entity_id) for record in records)
    assert "must-not-enter-audit" not in json.dumps([record.after for record in records])
    schema = client.get("/api/schema/?format=json")
    assert schema.status_code == 200
    paths = schema.json()["paths"]
    assert BASE + "tree/" in paths
    assert "503" in paths[BASE]["post"]["responses"]


@pytest.mark.parametrize("debug,opt_in", [(False, True), (True, False)])

def test_readiness_does_not_authorize_production_or_default_writes(client, oidc, settings, debug, opt_in):
    settings.DEBUG = debug
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = opt_in
    from apps.authorization.models import Role, UserRoleAssignment
    from apps.organizations.models import OrganizationType, OrganizationUnit
    from django.contrib.auth import get_user_model
    from django.core.management import call_command

    call_command("seed_rbac", verbosity=0)
    client.get("/api/me/", **oidc.header())
    user = get_user_model().objects.get(username="devuser")
    root_type, _ = OrganizationType.objects.get_or_create(code="UNIVERSITY", defaults={"name": "University"})
    root = OrganizationUnit.objects.create(code="RBAC-GATE", name="RBAC gate", organization_type=root_type)
    baseline_audit_events = AuditEvent.objects.count()
    role = Role.objects.get(code="platform-administrator")
    UserRoleAssignment.objects.get_or_create(
        user=user, role=role, scope=UserRoleAssignment.Scope.PLATFORM,
        defaults={"assigned_by": user},
    )
    authorized = {**oidc.header(), "HTTP_X_REQUEST_ID": str(uuid4())}
    for method, suffix in [("post", ""), ("patch", f"{root.pk}/"), ("post", f"{root.pk}/deactivate/"), ("post", f"{root.pk}/archive/")]:
        url = BASE + suffix
        assert getattr(client, method)(url, {}, content_type="application/json").status_code == 401
        claim_only = getattr(client, method)(url, {}, content_type="application/json", **oidc.header(realm_access={"roles": ["platform-admin"]}))
        assert claim_only.status_code in {403, 404}
        # Even a real database platform grant cannot override the independent
        # production/default-off development write gate.
        denied = getattr(client, method)(url, {}, content_type="application/json", **authorized)
        assert denied.status_code in {403, 404}
        assert denied.status_code >= 400
    assert OrganizationUnit.objects.count() == 1
    assert AuditEvent.objects.count() == baseline_audit_events
