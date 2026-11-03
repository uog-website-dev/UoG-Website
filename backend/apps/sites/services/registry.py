"""One transaction for a registry row lock, version check, save, and audit context."""
from contextlib import contextmanager

from django.db import DEFAULT_DB_ALIAS, transaction

from apps.audit.context import database_audit_context


@contextmanager
def registry_write(*, using=DEFAULT_DB_ALIAS):
    """Hold the mutation until lock, If-Match, validation, save, and audit context agree.

    ``select_for_update`` is invalid outside a transaction. Callers that lock a
    module, Site module, or template row must enter here before the lock.
    A validation or audit-context failure rolls the row change back.
    """
    with transaction.atomic(using=using), database_audit_context(using=using):
        yield
