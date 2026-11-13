"""Freeze visual v1 shape and include its media in revision/publication inventories."""
import importlib
from pathlib import Path
from django.db import migrations

SCHEMA = (Path(__file__).parent / "layout_v1_schema.json").read_text().replace("'", "''")
SQL = r"""
CREATE FUNCTION cms_layout_shape_valid(doc jsonb, spec jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; v jsonb; candidate jsonb; kind text := spec->>'type'; n numeric;
BEGIN
 IF spec ? 'oneOf' THEN
  FOR candidate IN SELECT value FROM jsonb_array_elements(spec->'oneOf') LOOP
   IF candidate->'properties'->'type'->'const'=doc->'type' THEN RETURN cms_layout_shape_valid(doc,candidate); END IF;
  END LOOP; RETURN false;
 END IF;
 IF spec ? 'const' AND doc IS DISTINCT FROM spec->'const' THEN RETURN false; END IF;
 IF spec ? 'enum' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(spec->'enum') e WHERE e.value=doc) THEN RETURN false; END IF;
 IF kind IS NOT NULL AND jsonb_typeof(doc) IS DISTINCT FROM (CASE WHEN kind='integer' THEN 'number' ELSE kind END) THEN RETURN false; END IF;
 IF kind='object' THEN
  FOR k IN SELECT jsonb_array_elements_text(spec->'required') LOOP IF NOT doc ? k THEN RETURN false; END IF; END LOOP;
  FOR k,v IN SELECT * FROM jsonb_each(doc) LOOP
   IF NOT (spec->'properties') ? k OR NOT cms_layout_shape_valid(v,spec->'properties'->k) THEN RETURN false; END IF;
  END LOOP;
 ELSIF kind='array' THEN
  IF jsonb_array_length(doc)<coalesce((spec->>'minItems')::int,0) OR jsonb_array_length(doc)>coalesce((spec->>'maxItems')::int,200) THEN RETURN false; END IF;
  FOR v IN SELECT value FROM jsonb_array_elements(doc) LOOP IF NOT cms_layout_shape_valid(v,spec->'items') THEN RETURN false; END IF; END LOOP;
 ELSIF kind='string' THEN
  k:=doc#>>'{}';
  IF length(k)<coalesce((spec->>'minLength')::int,0) OR length(k)>coalesce((spec->>'maxLength')::int,20000) THEN RETURN false; END IF;
  IF spec ? 'pattern' AND k !~ (spec->>'pattern') THEN RETURN false; END IF;
 ELSIF kind IN ('number','integer') THEN
  n:=(doc#>>'{}')::numeric;
  IF (kind='integer' AND n<>trunc(n)) OR (spec ? 'minimum' AND n<(spec->>'minimum')::numeric) OR (spec ? 'maximum' AND n>(spec->>'maximum')::numeric) THEN RETURN false; END IF;
 END IF;
 RETURN true;
END $$;

CREATE FUNCTION cms_layout_nodes(doc jsonb) RETURNS SETOF jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE entry jsonb; child jsonb;
BEGIN
 IF jsonb_typeof(doc)='object' THEN
  IF doc ? 'type' AND doc ? 'id' THEN RETURN NEXT doc; END IF;
  FOR entry IN SELECT value FROM jsonb_each(doc) LOOP RETURN QUERY SELECT * FROM cms_layout_nodes(entry); END LOOP;
 ELSIF jsonb_typeof(doc)='array' THEN
  FOR entry IN SELECT value FROM jsonb_array_elements(doc) LOOP RETURN QUERY SELECT * FROM cms_layout_nodes(entry); END LOOP;
 END IF;
END $$;

CREATE FUNCTION cms_layout_compact(doc jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result text;
BEGIN
 IF jsonb_typeof(doc)='object' THEN
  SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||cms_layout_compact(value),','),'')||'}' INTO result FROM jsonb_each(doc);
 ELSIF jsonb_typeof(doc)='array' THEN
  SELECT '['||coalesce(string_agg(cms_layout_compact(value),','),'')||']' INTO result FROM jsonb_array_elements(doc);
 ELSE result:=doc::text; END IF;
 RETURN result;
END $$;

CREATE FUNCTION cms_visual_layout_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc jsonb:=NEW.metadata->'visual_layout'; n bigint; distinct_n bigint; node jsonb; r jsonb;
BEGIN
 IF NOT NEW.metadata ? 'visual_layout' THEN RETURN NEW; END IF;
 IF octet_length(doc::text)>1048576 OR NOT cms_layout_shape_valid(doc,'__SCHEMA__'::jsonb) THEN
  RAISE EXCEPTION 'Invalid visual layout schema or version.' USING ERRCODE='23514',CONSTRAINT='cms_visual_layout_schema';
 END IF;
 IF octet_length(cms_layout_compact(doc))>262144 THEN RAISE EXCEPTION 'Visual layout too large.' USING ERRCODE='23514'; END IF;
 SELECT count(*),count(DISTINCT value->>'id') INTO n,distinct_n FROM cms_layout_nodes(doc) AS nodes(value);
 IF n>200 OR n<>distinct_n THEN RAISE EXCEPTION 'Visual layout node IDs must be unique and bounded.' USING ERRCODE='23514'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(doc->'rows') LOOP
  IF jsonb_array_length(r->'ratios')<>jsonb_array_length(r->'columns') THEN RAISE EXCEPTION 'Ratios must match columns.' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR node IN SELECT * FROM cms_layout_nodes(doc) LOOP
  IF node->'props' ? 'items' AND EXISTS(SELECT 1 FROM jsonb_array_elements(node->'props'->'items') i GROUP BY i->>'id' HAVING count(*)>1) THEN
   RAISE EXCEPTION 'Repeated items require unique IDs.' USING ERRCODE='23514';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER cms_visual_layout_guard BEFORE INSERT OR UPDATE ON cms_sitecontent FOR EACH ROW EXECUTE FUNCTION cms_visual_layout_guard();

CREATE FUNCTION media_effective_blocks(payload jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb:='[]'; node jsonb; props jsonb; sid text; field text;
BEGIN
 IF NOT coalesce(payload->'metadata','{}'::jsonb) ? 'visual_layout' THEN RETURN coalesce(payload->'blocks','[]'::jsonb); END IF;
 sid:=payload->>'site_id';
 -- Snapshot site_id is present in the revision contract. Asset ownership is
 -- independently checked by media_usage_guard against the actual Page Site.
 FOR node IN SELECT * FROM cms_layout_nodes(payload->'metadata'->'visual_layout') LOOP
  props:=node->'props';
  IF node->>'type' IN ('image','hero_image') THEN
   result:=result||jsonb_build_array(jsonb_build_object('id',node->>'id','type','visual_image','asset_id',props->>'asset_id'));
  ELSIF node->>'type' IN ('image_slider','image_grid') THEN
   field:=CASE WHEN node->>'type'='image_slider' THEN 'slides' ELSE 'images' END;
   result:=result||jsonb_build_array(jsonb_build_object('id',node->>'id','type','visual_media_items','items',props->'items'));
  END IF;
 END LOOP;
 RETURN result;
END $$;
""".replace("__SCHEMA__", SCHEMA)

BASE = importlib.import_module("apps.media.migrations.0010_reference_inventory_and_removal").SQL
START = BASE.index("CREATE FUNCTION media_sync_content_usage()")
END = BASE.index("CREATE TRIGGER media_revision_usage", START)
OLD = BASE[START:END].replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")
NEW = OLD.replace("NEW.snapshot->'blocks'", "media_effective_blocks(NEW.snapshot)").replace("NEW.payload->'blocks'", "media_effective_blocks(NEW.payload)")
EXTRACT_OLD = importlib.import_module("apps.media.migrations.0011_canonical_reference_inventory").SQL.split("-- Backfill")[0]
EXTRACT_NEW = EXTRACT_OLD.replace("IF kind='image' THEN", """IF kind='visual_image' THEN
      asset_id := (b->>'asset_id')::uuid; node_id:=node; field_path:='props.asset_id'; repeater_item_id:=''; RETURN NEXT;
    ELSIF kind='visual_media_items' THEN
      FOR item IN SELECT value FROM jsonb_array_elements(b->'items') LOOP
        asset_id := (item->>'asset_id')::uuid; node_id:=node; field_path:='props.items.asset_id'; repeater_item_id:=item->>'id'; RETURN NEXT;
      END LOOP;
    ELSIF kind='image' THEN""")
REVERSE = OLD + EXTRACT_OLD + """
DROP FUNCTION media_effective_blocks(jsonb);
DROP TRIGGER cms_visual_layout_guard ON cms_sitecontent;
DROP FUNCTION cms_visual_layout_guard();
DROP FUNCTION cms_layout_compact(jsonb);
DROP FUNCTION cms_layout_nodes(jsonb);
DROP FUNCTION cms_layout_shape_valid(jsonb,jsonb);
"""


class Migration(migrations.Migration):
    dependencies = [("cms", "0013_media_repeater_blocks"), ("media", "0012_asset_editable_metadata")]
    operations = [migrations.RunSQL(SQL + EXTRACT_NEW + NEW, REVERSE)]
