"""Index accepted historical UUID spellings without rewriting revision snapshots."""
from django.db import migrations
import importlib
BASE = importlib.import_module("apps.media.migrations.0010_reference_inventory_and_removal").SQL
OLD = BASE[:BASE.index("CREATE FUNCTION media_usage_guard")].replace("CREATE FUNCTION media_extract_uses", "CREATE OR REPLACE FUNCTION media_extract_uses")
SQL = r"""
CREATE OR REPLACE FUNCTION media_extract_uses(doc jsonb, owner_site bigint, prefix text DEFAULT 'blocks', depth integer DEFAULT 0)
RETURNS TABLE(asset_id uuid,node_id text,field_path text,repeater_item_id text) LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE b jsonb; item jsonb; n integer := 0; node text; kind text; ref text; field text;
BEGIN
  IF depth > 5 OR jsonb_typeof(doc) <> 'array' THEN RAISE EXCEPTION 'Invalid media tree.' USING ERRCODE='23514'; END IF;
  FOR b IN SELECT value FROM jsonb_array_elements(doc) LOOP
    kind := b->>'type'; node := coalesce(nullif(b->>'id',''),'legacy:' || prefix || '.' || n::text);
    IF kind='image' THEN
      ref := b->>'ref';
      IF ref ~ '^sites/[0-9]+/assets/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' THEN
        IF split_part(ref,'/',2)::bigint <> owner_site THEN RAISE EXCEPTION 'Foreign media reference.' USING ERRCODE='23514'; END IF;
        asset_id := split_part(ref,'/',4)::uuid; node_id:=node; field_path:='ref'; repeater_item_id:=''; RETURN NEXT;
      END IF;
    ELSIF kind IN ('slider','gallery') THEN
      field := CASE WHEN kind='slider' THEN 'slides' ELSE 'images' END;
      FOR item IN SELECT value FROM jsonb_array_elements(b->field) LOOP
        asset_id := (item->>'asset_id')::uuid; node_id:=node; field_path:=field || '.asset_id'; repeater_item_id:=item->>'id';
        IF asset_id IS NULL OR repeater_item_id IS NULL OR repeater_item_id='' THEN RAISE EXCEPTION 'Stable media items are required.' USING ERRCODE='23514'; END IF;
        RETURN NEXT;
      END LOOP;
    ELSIF kind='section' THEN
      RETURN QUERY SELECT * FROM media_extract_uses(b->'children',owner_site,prefix || '.' || n::text || '.children',depth+1);
    END IF;
    n := n+1;
  END LOOP;
END;
$$;

-- Backfill current sets, not historical draft/publication snapshots.
DO $$ DECLARE p record; r record; pub record;
BEGIN
 PERFORM set_config('media.usage_backfill','on',true);
 FOR p IN SELECT c.id,c.status FROM cms_page x JOIN cms_sitecontent c ON c.id=x.sitecontent_ptr_id LOOP
  SELECT * INTO r FROM cms_contentrevision WHERE content_id=p.id ORDER BY revision_number DESC LIMIT 1;
  IF r.id IS NOT NULL THEN
   PERFORM media_replace_usage(p.id,'DRAFT',r.id,NULL,CASE WHEN p.status IN ('PUBLISHED','ARCHIVED') THEN '[]'::jsonb ELSE r.snapshot->'blocks' END);
   IF p.status='PUBLISHED' THEN
    SELECT * INTO pub FROM cms_publishedcontentsnapshot WHERE content_id=p.id ORDER BY version DESC LIMIT 1;
    IF pub.id IS NOT NULL THEN PERFORM media_replace_usage(p.id,'PUBLIC',r.id,pub.id,pub.payload->'blocks'); END IF;
   END IF;
  END IF;
 END LOOP;
 PERFORM set_config('media.usage_backfill','',true);
END $$;
"""
class Migration(migrations.Migration):
    dependencies = [("media", "0010_reference_inventory_and_removal")]
    operations = [migrations.RunSQL(SQL, OLD)]
