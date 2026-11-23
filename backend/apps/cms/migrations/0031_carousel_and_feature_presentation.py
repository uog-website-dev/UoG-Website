"""Add bounded optional carousel/feature settings; preserve existing documents."""
from importlib import import_module
from pathlib import Path
from django.db import migrations
previous=import_module('apps.cms.migrations.0028_shared_homepage_presentation')
old_schema=(Path(__file__).parent/'0028_layout_schema.json').read_text(encoding='utf-8').replace("'","''")
new_schema=(Path(__file__).parent/'0031_layout_schema.json').read_text(encoding='utf-8').replace("'","''")
SQL=previous.SQL.replace(old_schema,new_schema)
assert SQL!=previous.SQL
class Migration(migrations.Migration):
    dependencies=[('cms','0030_five_submenu_levels')]
    operations=[migrations.RunSQL(SQL,previous.SQL)]
