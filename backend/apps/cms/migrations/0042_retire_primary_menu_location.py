"""Retire the unused primary menu location.

Templates and public chrome never rendered primary. Existing primary rows become
unassigned named menus so editors can reattach them to header/secondary/footer.

The check-constraint swap is state-forwarded with a one-way database rewrite so
migrate-back tests that share a transaction with pending cms_menu trigger events
(from menu-item writes) are not blocked by ALTER TABLE — same rationale as 0041.
"""

from django.db import migrations, models
from django.db.models import Q


def _clear_primary(apps, schema_editor):
    Menu = apps.get_model("cms", "Menu")
    Menu.objects.filter(location="primary").update(location="")


FORWARD_CONSTRAINT = """
ALTER TABLE cms_menu DROP CONSTRAINT IF EXISTS menu_configured_location;
ALTER TABLE cms_menu ADD CONSTRAINT menu_configured_location
CHECK (location IN ('', 'header', 'footer', 'sidebar', 'secondary'));
"""


class Migration(migrations.Migration):
    dependencies = [
        ("cms", "0041_remove_menu_allow_cross_site"),
    ]

    operations = [
        migrations.RunPython(_clear_primary, migrations.RunPython.noop),
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RemoveConstraint(model_name="menu", name="menu_configured_location"),
                migrations.AddConstraint(
                    model_name="menu",
                    constraint=models.CheckConstraint(
                        condition=Q(location__in=("", "header", "footer", "sidebar", "secondary")),
                        name="menu_configured_location",
                    ),
                ),
            ],
            database_operations=[
                migrations.RunSQL(FORWARD_CONSTRAINT, migrations.RunSQL.noop),
            ],
        ),
    ]
