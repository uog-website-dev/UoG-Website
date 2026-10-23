"""DEC-04 initial lookup data; preserve labels edited after installation."""
from django.db import migrations


INITIAL_TYPES = (
    ("UNIVERSITY", "University"),
    ("COLLEGE", "College"),
    ("SCHOOL", "School"),
    ("INSTITUTE", "Institute"),
    ("DEPARTMENT", "Department"),
    ("RESEARCH_CENTER", "Research Center"),
    ("DIRECTORATE", "Directorate"),
    ("OFFICE", "Office"),
    ("ADMINISTRATIVE_UNIT", "Administrative Unit"),
    ("OTHER", "Other"),
)


def seed_types(apps, schema_editor):
    OrganizationType = apps.get_model("organizations", "OrganizationType")
    for code, name in INITIAL_TYPES:
        OrganizationType.objects.using(schema_editor.connection.alias).get_or_create(
            code=code, defaults={"name": name},
        )


class Migration(migrations.Migration):
    dependencies = [("organizations", "0001_initial")]
    operations = [
        # A reverse migration must not delete records that administrators may
        # have renamed or that later institutional units may reference.
        migrations.RunPython(seed_types, reverse_code=migrations.RunPython.noop),
    ]
