"""Let existing review roles enter their assigned Site and inspect media."""
from django.db import migrations


def grant_review_reads(apps, schema_editor):
    using = schema_editor.connection.alias
    roles = apps.get_model("authorization","Role").objects.using(using).filter(code__in=["reviewer","publisher"],is_system=True)
    permissions = list(apps.get_model("authorization","Permission").objects.using(using).filter(code__in=["sites.view","content.media.view"],is_system=True))
    links = apps.get_model("authorization","RolePermission").objects.using(using)
    for role in roles:
        for permission in permissions:
            links.get_or_create(role_id=role.pk,permission_id=permission.pk)


class Migration(migrations.Migration):
    dependencies = [("api","0007_post_working_draft"),("authorization","0002_remove_userroleassignment_auth_assignment_live_uniq_and_more")]
    operations = [migrations.RunPython(grant_review_reads,migrations.RunPython.noop)]
