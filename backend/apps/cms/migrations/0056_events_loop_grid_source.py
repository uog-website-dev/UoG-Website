"""Allow approved Loop Grid / Blog widgets to use source=events without a new widget type."""
from importlib import import_module
from pathlib import Path

from django.db import migrations

previous = import_module("apps.cms.migrations.0044_document_list_widget")
old_schema = Path(__file__).with_name("0044_layout_schema.json").read_text(encoding="utf-8").replace("'", "''")
new_schema = Path(__file__).with_name("0056_layout_schema.json").read_text(encoding="utf-8").replace("'", "''")
SQL = previous.SQL.replace(old_schema, new_schema)
assert SQL != previous.SQL


class Migration(migrations.Migration):
    dependencies = [("cms", "0055_events_menu_destination")]
    operations = [migrations.RunSQL(SQL, previous.SQL)]
