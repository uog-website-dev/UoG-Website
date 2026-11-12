"""Editable display metadata is independent of immutable storage identity."""
from django.db import migrations, models
SQL = r"""
CREATE FUNCTION media_categories_valid(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'array' OR jsonb_array_length(value)>10 THEN RETURN false; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(value) LOOP
  IF jsonb_typeof(item) <> 'string' OR char_length(item #>> '{}') NOT BETWEEN 1 AND 64
    OR btrim(item #>> '{}')='' OR (item #>> '{}') ~ '[[:cntrl:]]' THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END;
$$;
"""
class Migration(migrations.Migration):
 dependencies = [("media", "0011_canonical_reference_inventory")]
 operations = [
  migrations.RunSQL(SQL, "DROP FUNCTION media_categories_valid(jsonb);"),
  migrations.AddField(model_name="mediaasset", name="display_name", field=models.CharField(max_length=255, blank=True, default="")),
  migrations.AddField(model_name="mediaasset", name="categories", field=models.JSONField(default=list, blank=True)),
  migrations.AddConstraint(model_name="mediaasset", constraint=models.CheckConstraint(condition=models.Func("categories", function="media_categories_valid", output_field=models.BooleanField()), name="media_asset_categories_valid")),
 ]
