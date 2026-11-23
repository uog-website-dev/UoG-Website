"""Optional bounded hero decoration and horizontal news presentation."""
from importlib import import_module
from pathlib import Path
from django.db import migrations
previous=import_module('apps.cms.migrations.0033_hero_design_controls')
old_schema=(Path(__file__).parent/'0033_layout_schema.json').read_text(encoding='utf-8').replace("'","''")
new_schema=(Path(__file__).parent/'0034_layout_schema.json').read_text(encoding='utf-8').replace("'","''")
SQL=previous.SQL.replace(old_schema,new_schema)
assert SQL!=previous.SQL
base=import_module('apps.cms.migrations.0014_visual_layout_contract')
start=base.SQL.index('CREATE FUNCTION media_effective_blocks')
OLD_MEDIA=base.SQL[start:].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
NEW_MEDIA=OLD_MEDIA.replace("  ELSIF node->>'type' IN ('image_slider','image_grid') THEN", """  IF node->>'type'='hero_image' AND jsonb_array_length(coalesce(props->'items','[]'::jsonb))>0 THEN
   result:=result||jsonb_build_array(jsonb_build_object('id',node->>'id','type','visual_media_items','items',props->'items'));
  END IF;
  ELSIF node->>'type' IN ('image_slider','image_grid') THEN""")
class Migration(migrations.Migration):
    dependencies=[('cms','0033_hero_design_controls')]
    operations=[migrations.RunSQL(SQL+NEW_MEDIA,previous.SQL+OLD_MEDIA)]
