"""Optional bounded hero decoration and horizontal news presentation."""
from importlib import import_module
from pathlib import Path
from django.db import migrations
previous=import_module('apps.cms.migrations.0031_carousel_and_feature_presentation')
old_schema=(Path(__file__).parent/'0031_layout_schema.json').read_text(encoding='utf-8').replace("'","''")
new_schema=(Path(__file__).parent/'0032_layout_schema.json').read_text(encoding='utf-8').replace("'","''")
SQL=previous.SQL.replace(old_schema,new_schema)
assert SQL!=previous.SQL
class Migration(migrations.Migration):
    dependencies=[('cms','0031_carousel_and_feature_presentation')]
    operations=[migrations.RunSQL(SQL,previous.SQL)]
