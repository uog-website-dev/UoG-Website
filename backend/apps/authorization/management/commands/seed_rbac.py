"""Idempotently load reviewed permissions and standard role templates."""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.authorization.catalog import CAPABILITIES, STANDARD_ROLES
from apps.authorization.models import Permission, Role, RolePermission


class Command(BaseCommand):
    help = "Seed the registered permission catalog and seven standard role templates."

    @transaction.atomic
    def handle(self, *args, **options):
        reserved_codes = [code for code, *_ in STANDARD_ROLES]
        if Role.objects.filter(code__in=reserved_codes, is_system=False).exists():
            raise ValueError("A custom role uses a reserved standard role code; resolve the collision before seeding.")

        permissions = {}
        for item in CAPABILITIES:
            permission, _created = Permission.objects.update_or_create(
                code=item.code,
                defaults={
                    "name": item.name,
                    "description": item.description,
                    "module": item.module,
                    "resource_type": item.resource_type,
                    "action": item.action,
                    "risk": item.risk,
                    "delegable": item.delegable,
                    "is_system": True,
                    "is_active": True,
                },
            )
            permissions[item.code] = permission

        for code, name, description, permission_codes in STANDARD_ROLES:
            role, _created = Role.objects.update_or_create(
                code=code,
                defaults={"name": name, "description": description, "is_system": True, "is_active": True},
            )
            expected = {permissions[permission_code].pk for permission_code in permission_codes}
            current = set(RolePermission.objects.filter(role=role).values_list("permission_id", flat=True))
            RolePermission.objects.filter(role=role, permission_id__in=current - expected).delete()
            RolePermission.objects.bulk_create(
                [RolePermission(role=role, permission_id=permission_id) for permission_id in expected - current],
                ignore_conflicts=True,
            )

        # Keep removed catalog codes non-executable and visible to auditors.
        Permission.objects.filter(is_system=True).exclude(code__in=permissions).update(is_active=False)
        self.stdout.write(self.style.SUCCESS(
            f"Seeded {len(permissions)} registered permissions and {len(STANDARD_ROLES)} standard roles. "
            "No user assignments were created."
        ))
