"""Translate shared SQL lifecycle enforcement into domain validation errors."""
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connections, transaction


def validate_site(site, *, using):
    try:
        with transaction.atomic(using=using), connections[using].cursor() as cursor:
            cursor.execute("SELECT sites_validate_lifecycle(%s, %s, %s, %s, %s)", [
                site.pk, site.code, site.organization_unit_id, site.status, site.is_main,
            ])
    except IntegrityError as exc:
        diagnostic = getattr(exc.__cause__, "diag", None)
        fields = {
            "site_immutable_code": "code", "site_owner_valid": "organization_unit",
            "site_active_owner": "organization_unit", "site_new_owner": "organization_unit",
            "site_main_owner": "organization_unit", "site_lifecycle_status": "status",
            "site_archived_structure": "organization_unit",
        }
        field = fields.get(getattr(diagnostic, "constraint_name", None))
        if field is None:
            raise
        raise ValidationError({field: diagnostic.message_primary}) from exc
