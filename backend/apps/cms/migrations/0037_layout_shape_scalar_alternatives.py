"""Make the database layout guard accept scalar `oneOf` alternatives.

The JSON schema uses `oneOf` for two different things: node-type alternatives
(keyed by `properties.type.const`) and scalar alternatives such as an approved
token or an RGB colour (for example a section `background`). The plpgsql helper
only understood the node form, so a validated layout with any presentation
colour or token alternative failed the database guard and surfaced as a save
conflict. The shared Python validator had the same gap and is fixed alongside
this schema migration.

The function is replaced in place; no table, row or CMS revision is touched.
Reversing restores the previous helper definition.
"""
from django.db import migrations

FORWARD = r"""
CREATE OR REPLACE FUNCTION cms_layout_shape_valid(doc jsonb, spec jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; v jsonb; candidate jsonb; kind text := spec->>'type'; n numeric; nodes boolean;
BEGIN
 IF spec ? 'oneOf' THEN
  SELECT bool_and(jsonb_typeof(value->'properties'->'type')='object') INTO nodes
    FROM jsonb_array_elements(spec->'oneOf');
  IF coalesce(nodes,false) THEN
   FOR candidate IN SELECT value FROM jsonb_array_elements(spec->'oneOf') LOOP
    IF candidate->'properties'->'type'->'const'=doc->'type' THEN RETURN cms_layout_shape_valid(doc,candidate); END IF;
   END LOOP; RETURN false;
  END IF;
  FOR candidate IN SELECT value FROM jsonb_array_elements(spec->'oneOf') LOOP
   IF cms_layout_shape_valid(doc,candidate) THEN RETURN true; END IF;
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
"""

REVERSE = r"""
CREATE OR REPLACE FUNCTION cms_layout_shape_valid(doc jsonb, spec jsonb) RETURNS boolean
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
"""


class Migration(migrations.Migration):
    dependencies = [("cms", "0036_page_chrome_setting")]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
