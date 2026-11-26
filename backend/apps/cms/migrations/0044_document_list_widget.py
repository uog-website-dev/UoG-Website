"""Promote the reviewed Document List widget in the database layout guard."""
from importlib import import_module
from pathlib import Path

from django.db import migrations

previous = import_module("apps.cms.migrations.0036_page_chrome_setting")
old_schema = Path(__file__).with_name("0036_layout_schema.json").read_text(encoding="utf-8").replace("'", "''")
new_schema = Path(__file__).with_name("0044_layout_schema.json").read_text(encoding="utf-8").replace("'", "''")
SQL = previous.SQL.replace(old_schema, new_schema)
assert SQL != previous.SQL


class Migration(migrations.Migration):
    dependencies = [("cms", "0043_documents_menu_destination")]
    operations = [migrations.RunSQL(SQL, previous.SQL)]
