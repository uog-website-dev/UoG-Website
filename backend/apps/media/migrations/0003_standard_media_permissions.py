"""Extend existing standard roles without creating users or assignments."""
from django.db import migrations

CODES = ("content.media.view", "content.media.upload", "content.media.delete")
ROLES = ("platform-administrator", "site-administrator")


def forward(apps, schema_editor):
    using = schema_editor.connection.alias
    roles = apps.get_model("authorization", "Role").objects.using(using).filter(code__in=ROLES, is_system=True)
    permissions = apps.get_model("authorization", "Permission").objects.using(using).filter(code__in=CODES, is_system=True)
    links = apps.get_model("authorization", "RolePermission").objects.using(using)
    for role in roles:
        for permission in permissions:
            links.get_or_create(role_id=role.pk, permission_id=permission.pk)


def reverse(apps, schema_editor):
    apps.get_model("authorization", "RolePermission").objects.using(schema_editor.connection.alias).filter(
        role__code__in=ROLES, role__is_system=True, permission__code__in=CODES,
    ).delete()


class Migration(migrations.Migration):
    dependencies = [("media", "0002_integrity"), ("authorization", "0002_remove_userroleassignment_auth_assignment_live_uniq_and_more")]
    operations = [migrations.RunPython(forward, reverse)]
