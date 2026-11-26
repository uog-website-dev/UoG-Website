from django.db import migrations, models

FORWARD = "SET CONSTRAINTS ALL IMMEDIATE; ALTER TABLE cms_menuitem DROP CONSTRAINT menu_item_type; ALTER TABLE cms_menuitem ADD CONSTRAINT menu_item_type CHECK (item_type IN ('page','post','external','custom','news','category','docs'));"
REVERSE = "SET CONSTRAINTS ALL IMMEDIATE; ALTER TABLE cms_menuitem DROP CONSTRAINT menu_item_type; ALTER TABLE cms_menuitem ADD CONSTRAINT menu_item_type CHECK (item_type IN ('page','post','external','custom','news','category'));"


class Migration(migrations.Migration):
    dependencies = [("cms", "0042_document_access_settings")]
    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[migrations.RunSQL(FORWARD, REVERSE)],
            state_operations=[migrations.AlterField(
                model_name="menuitem", name="item_type",
                field=models.CharField(max_length=8, choices=[("page", "Page"), ("post", "Post"), ("external", "External"), ("custom", "Custom"), ("news", "News listing"), ("category", "News category"), ("docs", "Documents & Files")]),
            ), migrations.RemoveConstraint(model_name="menuitem", name="menu_item_type"), migrations.AddConstraint(
                model_name="menuitem", constraint=models.CheckConstraint(condition=models.Q(item_type__in=["page", "post", "external", "custom", "news", "category", "docs"]), name="menu_item_type"),
            )],
        ),
    ]
