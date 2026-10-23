"""Reusable synchronous writer; failures propagate and roll back the caller."""
import json

from django.db import DEFAULT_DB_ALIAS, connections

from .context import database_audit_context


def record_event(*, action, entity_type, entity_id, before=None, after=None, changed_fields=(), using=DEFAULT_DB_ALIAS):
    """Return an event ID; join the business transaction on the same DB alias.

    Callers supply domain-approved snapshot allowlists. SQL sanitization is
    additional protection, not permission to log raw request bodies/secrets.
    """
    with database_audit_context(using=using), connections[using].cursor() as cursor:
        cursor.execute(
            "SELECT audit_record_event(%s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb)",
            [action, entity_type, str(entity_id), json.dumps(before), json.dumps(after), json.dumps(list(changed_fields))],
        )
        return cursor.fetchone()[0]
