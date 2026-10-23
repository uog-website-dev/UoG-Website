"""Expose the database lifecycle rules as readable domain validation errors."""
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connections, transaction


def validate_lifecycle(unit, *, using):
    # A savepoint keeps form validation failures from poisoning an enclosing
    # transaction. Model.save invokes this again under the hierarchy guard.
    try:
        with transaction.atomic(using=using), connections[using].cursor() as cursor:
            cursor.execute(
                "SELECT organizations_validate_unit_lifecycle(%s, %s, %s, %s)",
                [unit.pk, unit.organization_type_id, unit.parent_id, unit.status],
            )
    except IntegrityError as exc:
        diagnostic = getattr(exc.__cause__, "diag", None)
        name = getattr(diagnostic, "constraint_name", "") or ""
        fields = {
            "organization_lifecycle_root": "parent",
            "organization_lifecycle_type": "organization_type",
            "organization_lifecycle_parent": "parent",
            "organization_lifecycle_status": "status",
            "organization_lifecycle_descendants": "status",
            "organization_lifecycle_sites": "status",
            "organization_lifecycle_archived_structure": "parent",
        }
        if name not in fields:
            raise
        raise ValidationError({fields[name]: diagnostic.message_primary}) from exc
