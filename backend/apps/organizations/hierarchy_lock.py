"""Common write serialization, also enforced by PostgreSQL statement triggers."""
from contextlib import contextmanager

from django.db import DEFAULT_DB_ALIAS, connections, transaction
from apps.audit.context import database_audit_context


@contextmanager
def hierarchy_write(*, using=DEFAULT_DB_ALIAS):
    """Acquire the guard before reading entities or locking unit rows.

    The guard is updated, not just locked: a repeatable-read transaction with
    an outdated snapshot must fail serialization instead of using stale data.
    Its lock remains held until the outermost transaction completes.
    """
    with transaction.atomic(using=using), database_audit_context(using=using):
        with connections[using].cursor() as cursor:
            cursor.execute("SELECT organizations_lock_hierarchy()")
        yield
