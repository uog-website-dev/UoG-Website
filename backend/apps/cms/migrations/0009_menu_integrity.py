from django.db import migrations, models

from apps.cms import menu_sql


class Migration(migrations.Migration):
    dependencies = [("cms", "0008_menu_menuitem")]

    operations = [
        migrations.AddField(
            model_name="menu", name="is_active",
            field=models.BooleanField(default=True),
        ),
        migrations.AddConstraint(
            model_name="menu",
            constraint=models.CheckConstraint(
                condition=models.Q(location__in=("header", "footer", "sidebar", "primary", "secondary")),
                name="menu_configured_location",
            ),
        ),
        migrations.RunSQL(menu_sql.FORWARD, menu_sql.REVERSE),
    ]
