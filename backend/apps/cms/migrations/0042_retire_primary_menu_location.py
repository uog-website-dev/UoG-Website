"""Retire the unused primary menu location.

Templates and public chrome never rendered primary. Existing primary rows become
unassigned named menus so editors can reattach them to header/secondary/footer.
"""

from django.db import migrations, models
from django.db.models import Q


def _clear_primary(apps, schema_editor):
    Menu = apps.get_model("cms", "Menu")
    Menu.objects.filter(location="primary").update(location="")


class Migration(migrations.Migration):
    dependencies = [
        ("cms", "0041_remove_menu_allow_cross_site"),
    ]

    operations = [
        migrations.RunPython(_clear_primary, migrations.RunPython.noop),
        migrations.RemoveConstraint(model_name="menu", name="menu_configured_location"),
        migrations.AddConstraint(
            model_name="menu",
            constraint=models.CheckConstraint(
                condition=Q(location__in=("", "header", "footer", "sidebar", "secondary")),
                name="menu_configured_location",
            ),
        ),
    ]
