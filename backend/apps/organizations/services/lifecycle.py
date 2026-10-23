"""Lifecycle changes are explicit, serialized, and never cascade to other rows."""
from django.db import DEFAULT_DB_ALIAS

from ..hierarchy_lock import hierarchy_write
from ..models import OrganizationUnit


def transition_unit(unit_id, *, status, using=DEFAULT_DB_ALIAS):
    with hierarchy_write(using=using):
        unit = OrganizationUnit.objects.using(using).get(pk=unit_id)
        unit.status = status
        unit.save(using=using, update_fields=["status"])
        return unit


def deactivate_unit(unit_id, *, using=DEFAULT_DB_ALIAS):
    return transition_unit(unit_id, status=OrganizationUnit.Status.INACTIVE, using=using)


def archive_unit(unit_id, *, using=DEFAULT_DB_ALIAS):
    return transition_unit(unit_id, status=OrganizationUnit.Status.ARCHIVED, using=using)


def delete_unit(unit_id, *, using=DEFAULT_DB_ALIAS):
    with hierarchy_write(using=using):
        unit = OrganizationUnit.objects.using(using).get(pk=unit_id)
        unit.delete(using=using)  # The domain rejects all destructive unit deletion.
