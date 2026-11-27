"""Drop retired primary from menu inheritance and delivery-version guards.

0042 retired primary on cms_menu. These companion tables still allowed the old
location key in Django state and database checks.
"""

from django.db import migrations, models
from django.db.models import Q


def _clear_primary(apps, schema_editor):
    for model in ("MenuInheritance", "MenuDeliveryVersion"):
        apps.get_model("cms", model).objects.filter(location="primary").delete()


FORWARD = """
ALTER TABLE cms_menuinheritance DROP CONSTRAINT IF EXISTS menu_inheritance_location;
ALTER TABLE cms_menuinheritance ADD CONSTRAINT menu_inheritance_location
CHECK (location IN ('header', 'footer', 'sidebar', 'secondary'));
ALTER TABLE cms_menudeliveryversion DROP CONSTRAINT IF EXISTS menu_delivery_version_location;
ALTER TABLE cms_menudeliveryversion ADD CONSTRAINT menu_delivery_version_location
CHECK (location IN ('header', 'footer', 'sidebar', 'secondary'));
"""

REVERSE = """
ALTER TABLE cms_menuinheritance DROP CONSTRAINT IF EXISTS menu_inheritance_location;
ALTER TABLE cms_menuinheritance ADD CONSTRAINT menu_inheritance_location
CHECK (location IN ('header', 'footer', 'sidebar', 'primary', 'secondary'));
ALTER TABLE cms_menudeliveryversion DROP CONSTRAINT IF EXISTS menu_delivery_version_location;
ALTER TABLE cms_menudeliveryversion ADD CONSTRAINT menu_delivery_version_location
CHECK (location IN ('header', 'footer', 'sidebar', 'primary', 'secondary'));
"""

LOCATIONS = ("header", "footer", "sidebar", "secondary")


class Migration(migrations.Migration):
    dependencies = [
        ("cms", "0045_merge_documents_and_menu_retirement"),
    ]

    operations = [
        migrations.RunPython(_clear_primary, migrations.RunPython.noop),
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RemoveConstraint(model_name="menudeliveryversion", name="menu_delivery_version_location"),
                migrations.RemoveConstraint(model_name="menuinheritance", name="menu_inheritance_location"),
                migrations.AddConstraint(
                    model_name="menudeliveryversion",
                    constraint=models.CheckConstraint(condition=Q(location__in=LOCATIONS), name="menu_delivery_version_location"),
                ),
                migrations.AddConstraint(
                    model_name="menuinheritance",
                    constraint=models.CheckConstraint(condition=Q(location__in=LOCATIONS), name="menu_inheritance_location"),
                ),
            ],
            database_operations=[migrations.RunSQL(FORWARD, REVERSE)],
        ),
    ]
