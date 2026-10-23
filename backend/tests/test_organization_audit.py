"""Audit significant domain changes across HTTP, ORM, services and raw SQL."""
import json
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import DatabaseError, connection, transaction

from apps.audit.context import audit_context, database_audit_context
from apps.audit.models import AuditEvent
from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.organizations.services.hierarchy import move_unit
from apps.organizations.services.lifecycle import archive_unit, deactivate_unit

pytestmark = pytest.mark.django_db
BASE = "/api/v1/organizations/"


@pytest.fixture
def units():
    kinds = {code: OrganizationType.objects.get_or_create(code=code, defaults={"name": code.title()})[0] for code in ["UNIVERSITY", "COLLEGE", "DEPARTMENT"]}
    root = OrganizationUnit.objects.create(code="UOG", name="University", organization_type=kinds["UNIVERSITY"])
    college = OrganizationUnit.objects.create(code="CI", name="College", organization_type=kinds["COLLEGE"], parent=root)
    department = OrganizationUnit.objects.create(code="CS", name="Department", organization_type=kinds["DEPARTMENT"], parent=college)
    return root, college, department


def events(unit):
    return AuditEvent.objects.filter(entity_type="organizations.organizationunit", entity_id=str(unit.pk)).order_by("pk")


def test_model_and_services_generate_create_update_move_lifecycle_events(units):
    root, college, department = units
    assert events(root).get().action == "ORGANIZATION_CREATED"
    assert events(root).get().before is None
    assert events(root).get().after["id"] == root.pk
    with audit_context(actor_id="job:organization-maintenance"):
        department.name = "Renamed department"
        department.save(update_fields=["name"])
        move_unit(department.pk, parent_id=root.pk)
        deactivate_unit(department.pk)
        archive_unit(department.pk)
    records = list(events(department))
    assert [record.action for record in records] == ["ORGANIZATION_CREATED", "ORGANIZATION_UPDATED", "ORGANIZATION_MOVED", "ORGANIZATION_DEACTIVATED", "ORGANIZATION_ARCHIVED"]
    assert records[1].before["name"] == "Department"
    assert records[1].after["name"] == "Renamed department"
    assert records[2].before["parent_id"] == college.pk
    assert records[2].after["parent_id"] == root.pk
    assert records[3].before["status"] == "ACTIVE"
    assert records[3].after["status"] == "INACTIVE"
    assert records[4].after["status"] == "ARCHIVED"
    assert all((record.actor_kind, record.actor_id) == ("SYSTEM", "job:organization-maintenance") for record in records[1:])


def test_api_actor_request_peer_and_sanitized_snapshots(client, oidc, settings, units):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    root, college, _ = units
    request_id = str(uuid4())
    headers = {**oidc.header(), "HTTP_X_REQUEST_ID": request_id, "REMOTE_ADDR": "198.51.100.10", "HTTP_X_FORWARDED_FOR": "203.0.113.77", "HTTP_X_ACTOR_ID": "forged"}
    response = client.post(BASE, {"code": "AUDITED", "name": "Audited unit", "parent": root.pk, "organization_type": "COLLEGE", "description": "private secret text", "metadata": {"password": "nope", "nested": {"token": "never-log"}}}, content_type="application/json", **headers)
    assert response.status_code == 201, response.content
    unit = OrganizationUnit.objects.get(pk=response.json()["id"])
    record = events(unit).get()
    assert (record.actor_kind, record.actor_id) == ("USER", str(get_user_model().objects.get(username="devuser").pk))
    assert str(record.request_id) == request_id
    assert record.ip == "198.51.100.10"
    assert "metadata" not in record.after and "description" not in record.after
    assert not any(secret in json.dumps(record.after) for secret in ["nope", "never-log", "private secret"])
    url = response["Location"]
    changed = client.patch(url, {"name": "Updated", "parent": college.pk, "metadata": {"token": "another-secret"}}, content_type="application/json", HTTP_IF_MATCH=response["ETag"], **headers)
    assert changed.status_code == 200
    assert list(events(unit).values_list("action", flat=True)) == ["ORGANIZATION_CREATED", "ORGANIZATION_UPDATED", "ORGANIZATION_MOVED"]
    assert "metadata" in events(unit).last().changed_fields
    inactive = client.post(url + "deactivate/", {}, content_type="application/json", HTTP_IF_MATCH=changed["ETag"], **headers)
    assert inactive.status_code == 200
    archived = client.post(url + "archive/", {}, content_type="application/json", HTTP_IF_MATCH=inactive["ETag"], **headers)
    assert archived.status_code == 200
    assert events(unit).last().action == "ORGANIZATION_ARCHIVED"


def test_metadata_only_and_description_only_changes_are_recorded_without_values(units):
    _, _, unit = units
    unit.metadata = {"api_key": "credential"}
    unit.save(update_fields=["metadata"])
    unit.description = "Sensitive free-form text"
    unit.save(update_fields=["description"])
    records = list(events(unit))
    assert [record.changed_fields for record in records[1:]] == [["metadata"], ["description"]]
    assert all(record.action == "ORGANIZATION_UPDATED" for record in records[1:])
    assert "credential" not in json.dumps([record.after for record in records])


def test_noop_or_rejected_operations_do_not_create_misleading_events(units):
    root, college, unit = units
    before = events(unit).count()
    unit.save()
    assert events(unit).count() == before
    with pytest.raises(ValidationError):
        move_unit(college.pk, parent_id=unit.pk)
    assert events(college).count() == 1
    unit.status = "INACTIVE"
    unit.save(update_fields=["status"])
    unit.status = "ACTIVE"
    with pytest.raises(ValidationError):
        unit.save(update_fields=["status"])
    assert not events(unit).filter(action="ORGANIZATION_ACTIVATED").exists()


def test_bulk_and_raw_sql_mutations_use_same_common_writer(units):
    root, college, unit = units
    with audit_context(actor_kind="USER", actor_id="77"):
        OrganizationUnit.objects.filter(pk=unit.pk).update(name="Queryset update")
        unit.name = "Bulk update"
        OrganizationUnit.objects.bulk_update([unit], ["name"])
        OrganizationUnit.objects.bulk_create([OrganizationUnit(code="BULK", name="Bulk unit", parent=root, organization_type=college.organization_type)])
        with database_audit_context(), connection.cursor() as cursor:
            cursor.execute("UPDATE organizations_organizationunit SET name='SQL update' WHERE id=%s", [unit.pk])
    assert list(events(unit).values_list("action", flat=True)) == ["ORGANIZATION_CREATED", "ORGANIZATION_UPDATED", "ORGANIZATION_UPDATED", "ORGANIZATION_UPDATED"]
    assert all(record.actor_id == "77" for record in list(events(unit))[1:])
    bulk = OrganizationUnit.objects.get(code="BULK")
    assert events(bulk).get().actor_id == "77"
    with connection.cursor() as cursor:
        cursor.execute("UPDATE organizations_organizationunit SET name='Unattributed maintenance' WHERE id=%s", [unit.pk])
    assert events(unit).last().actor_kind == "SYSTEM"


@pytest.fixture
def broken_audit_storage():
    with connection.cursor() as cursor:
        cursor.execute("""
            CREATE FUNCTION audit_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'storage password must never leak'; END; $$;
            CREATE TRIGGER audit_test_failure BEFORE INSERT ON audit_auditevent
            FOR EACH ROW EXECUTE FUNCTION audit_test_failure();
        """)


def test_audit_failure_rolls_back_domain_operation(units, broken_audit_storage):
    _, _, unit = units
    with pytest.raises(DatabaseError) as failure:
        deactivate_unit(unit.pk)
    assert failure.value.__cause__.diag.constraint_name == "audit_write_failed"
    unit.refresh_from_db()
    assert unit.status == "ACTIVE"
    assert events(unit).count() == 1


def test_api_audit_failure_is_sanitized_503_and_rolls_back(client, oidc, settings, units, broken_audit_storage):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    root, _, _ = units
    response = client.post(BASE, {"code": "FAILED", "name": "Not committed", "organization_type": "COLLEGE", "parent": root.pk}, content_type="application/json", **oidc.header())
    assert response.status_code == 503, response.content
    assert response.json()["error"]["code"] == "service_unavailable"
    assert "password" not in response.content.decode()
    assert not OrganizationUnit.objects.filter(code="FAILED").exists()
    assert not AuditEvent.objects.filter(after__code="FAILED").exists()


def test_outer_rollback_discards_both_organization_and_event(units):
    _, _, unit = units
    with pytest.raises(RuntimeError), transaction.atomic():
        unit.name = "Rolled back"
        unit.save()
        raise RuntimeError()
    unit.refresh_from_db()
    assert unit.name == "Department"
    assert events(unit).count() == 1


def test_django_admin_changes_capture_session_actor(client, units):
    root, college, _ = units
    user = get_user_model().objects.create_user(username="auditor-admin", is_staff=True, is_superuser=True)
    client.force_login(user)
    response = client.post("/admin/organizations/organizationunit/add/", {
        "code": "ADMIN_CREATED", "name": "Created in admin", "short_name": "", "description": "",
        "organization_type": college.organization_type_id, "parent": root.pk, "status": "ACTIVE", "metadata": "{}", "_save": "Save",
    })
    assert response.status_code == 302, response.content
    unit = OrganizationUnit.objects.get(code="ADMIN_CREATED")
    assert events(unit).get().actor_id == str(user.pk)
