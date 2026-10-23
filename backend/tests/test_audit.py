"""Reusable audit contract, persistence, sanitization, identity and failure policy."""
from uuid import uuid4

import pytest
from django.core.exceptions import ValidationError
from django.db import DatabaseError, IntegrityError, connection, transaction

from apps.audit.context import AuditContext, audit_context, current_audit_context
from apps.audit.models import AuditEvent
from apps.audit.writer import record_event

pytestmark = pytest.mark.django_db


def test_common_writer_persists_reusable_contract_and_nested_redaction():
    request_id = uuid4()
    with audit_context(actor_kind="USER", actor_id="42", request_id=request_id, ip="2001:db8::1"):
        event_id = record_event(
            action="DOCUMENT_UPDATED", entity_type="example.document", entity_id="external-123",
            before={"name": "Before"},
            after={"name": "After", "password": "never-store", "nested": [{"access_token": "jwt-secret", "ok": 1}], "privateKey": "key"},
            changed_fields=["name", "password", "nested"],
        )
    event = AuditEvent.objects.get(pk=event_id)
    assert (event.actor_kind, event.actor_id) == ("USER", "42")
    assert event.action == "DOCUMENT_UPDATED"
    assert event.entity_type == "example.document"
    assert event.entity_id == "external-123"
    assert event.request_id == request_id
    assert event.ip == "2001:db8::1"
    assert event.timestamp is not None
    assert event.before == {"name": "Before"}
    assert event.after == {"name": "After", "password": "[REDACTED]", "nested": [{"access_token": "[REDACTED]", "ok": 1}], "privateKey": "[REDACTED]"}


def test_context_defaults_to_system_and_nested_context_does_not_leak():
    with audit_context(actor_id="job:directory-sync"):
        first = record_event(action="SYNC_STARTED", entity_type="example.sync", entity_id="1")
        with audit_context(actor_kind="USER", actor_id="7"):
            second = record_event(action="SYNC_UPDATED", entity_type="example.sync", entity_id="1")
        third = record_event(action="SYNC_FINISHED", entity_type="example.sync", entity_id="1")
    fourth = record_event(action="SYNC_FINISHED", entity_type="example.sync", entity_id="2")
    assert list(AuditEvent.objects.filter(pk__in=[first, second, third, fourth]).order_by("pk").values_list("actor_kind", "actor_id")) == [
        ("SYSTEM", "job:directory-sync"), ("USER", "7"), ("SYSTEM", "job:directory-sync"), ("SYSTEM", "system"),
    ]
    assert current_audit_context() == AuditContext()


def test_rollback_discards_event_with_business_transaction():
    with pytest.raises(RuntimeError), transaction.atomic():
        record_event(action="EXAMPLE_CREATED", entity_type="example.record", entity_id="1")
        raise RuntimeError("Abort business transaction")
    assert not AuditEvent.objects.exists()


def test_audit_records_reject_orm_and_sql_mutation():
    event = AuditEvent.objects.get(pk=record_event(action="EXAMPLE_CREATED", entity_type="example.record", entity_id="1"))
    with pytest.raises(ValidationError):
        event.save()
    with pytest.raises(ValidationError):
        event.delete()
    with pytest.raises(IntegrityError, match="append-only"), transaction.atomic():
        AuditEvent.objects.filter(pk=event.pk).update(action="FORGED")
    with pytest.raises(IntegrityError, match="append-only"), transaction.atomic():
        AuditEvent.objects.filter(pk=event.pk).delete()
    with pytest.raises(IntegrityError, match="append-only"), transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("UPDATE audit_auditevent SET actor_id='forged' WHERE id=%s", [event.pk])


@pytest.mark.parametrize("overrides", [{"action": "invalid action"}, {"entity_type": ""}, {"entity_id": ""}, {"after": ["not an object"]}, {"after": {"value": "x" * 66000}}, {"changed_fields": [{}]}])
def test_invalid_common_contract_fails_closed(overrides):
    arguments = {"action": "EXAMPLE_CREATED", "entity_type": "example.record", "entity_id": "1", **overrides}
    with pytest.raises(DatabaseError) as error:
        record_event(**arguments)
    assert error.value.__cause__.diag.constraint_name == "audit_write_failed"
    assert not AuditEvent.objects.exists()


def test_context_reset_after_failure_and_invalid_identity():
    with pytest.raises(ValueError):
        with audit_context(actor_kind="UNTRUSTED", actor_id="7"):
            pass
    with pytest.raises(ValueError):
        with audit_context(ip="not-an-ip"):
            pass
    with pytest.raises(RuntimeError):
        with audit_context(actor_kind="USER", actor_id="99"):
            raise RuntimeError()
    assert current_audit_context() == AuditContext()
