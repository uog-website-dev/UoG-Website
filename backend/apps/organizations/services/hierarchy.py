"""Transactional hierarchy operations; no type-specific branching or auth bypass."""
from django.db import DEFAULT_DB_ALIAS

from ..hierarchy_lock import hierarchy_write
from ..models import OrganizationUnit


def move_unit(unit_id, *, parent_id, using=DEFAULT_DB_ALIAS):
    """Move a unit after serialization and revalidate against committed state.

    Authorization belongs to the calling application boundary. Invalid moves
    raise ValidationError; database/serialization failures propagate so the
    caller can roll back and, when appropriate, retry the whole transaction.
    """
    with hierarchy_write(using=using):
        unit = OrganizationUnit.objects.using(using).get(pk=unit_id)
        unit.parent_id = parent_id
        unit.save(using=using, update_fields=["parent"])
        return unit
