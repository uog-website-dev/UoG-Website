"""One transaction for a registry row lock, version check, save, and audit context."""
from contextlib import contextmanager

from django.db import DEFAULT_DB_ALIAS

from apps.audit.context import database_audit_context
from apps.organizations.hierarchy_lock import hierarchy_write


@contextmanager
def registry_write(*, using=DEFAULT_DB_ALIAS):
    """Hold the mutation until lock, If-Match, validation, save, and audit context agree.

    ``select_for_update`` is invalid outside a transaction. Callers that lock a
    module, Site module, or template row must enter here before the lock.
    A validation or audit-context failure rolls the row change back.
    """
    # Acquire the common guard before any row lock. Bulk operations, Site
    # lifecycle changes and individual module switches must use this order.
    with hierarchy_write(using=using), database_audit_context(using=using):
        yield
