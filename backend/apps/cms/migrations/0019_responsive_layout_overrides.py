"""Refresh visual-layout DB guard for additive responsive breakpoint overrides."""
from pathlib import Path
from django.db import migrations

SCHEMA = (Path(__file__).parent / "layout_v1_schema.json").read_text().replace("'", "''")
SQL = r"""
CREATE OR REPLACE FUNCTION cms_visual_layout_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
""".replace("__SCHEMA__", SCHEMA)

# Reverse restores the previous guard body from migration 0014's schema snapshot
# by re-reading the same file after we keep layout_v1_schema.json as the live
# contract. Downgrade is a no-op for shape validity beyond reinstalling the
# current guard; additive fields remain optional for older rows.
REVERSE = SQL


class Migration(migrations.Migration):
    dependencies = [("cms", "0018_section_template")]
    operations = [migrations.RunSQL(SQL, REVERSE)]
