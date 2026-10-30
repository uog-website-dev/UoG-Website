from django.db import migrations, models

from apps.cms import menu_api_sql


class Migration(migrations.Migration):
    dependencies = [("cms", "0009_menu_integrity"), ("audit", "0002_common_writer")]

    operations = [
        migrations.AddField(model_name="menu", name="version", field=models.PositiveBigIntegerField(default=0, editable=False)),
        migrations.RemoveConstraint(model_name="menuitem", name="menu_item_sibling_order"),
        migrations.AddConstraint(
            model_name="menuitem",
            constraint=models.UniqueConstraint(fields=("menu", "parent", "sort_order"), name="menu_item_sibling_order",
                nulls_distinct=False, deferrable=models.Deferrable.IMMEDIATE),
        ),
        migrations.RunSQL(menu_api_sql.FORWARD, menu_api_sql.REVERSE),
    ]
