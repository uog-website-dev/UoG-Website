"""Allow deactivation after schema evolution without rewriting retained settings."""
from django.db import migrations


FUNCTION = r"""
CREATE OR REPLACE FUNCTION sites_enforce_site_module() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    module_status text;
    module_enabled boolean;
    module_code text;
    module_schema jsonb;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Disabling a Site module keeps its configuration. Turn it off instead of deleting it.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_module_no_delete';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.site_id IS DISTINCT FROM OLD.site_id OR NEW.module_id IS DISTINCT FROM OLD.module_id) THEN
        RAISE EXCEPTION 'A Site module assignment cannot be moved.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_module_immutable_assignment';
    END IF;
    SELECT status, is_enabled, code, configuration_schema
        INTO module_status, module_enabled, module_code, module_schema
        FROM sites_module WHERE id = NEW.module_id;
    IF TG_OP = 'INSERT' AND NOT NEW.is_enabled THEN
        RAISE EXCEPTION 'A disabled or unimplemented module cannot be enabled for a Site.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_module_requires_usable';
    END IF;
    IF (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.is_enabled AND NOT OLD.is_enabled)) AND (
        module_status IS DISTINCT FROM 'IMPLEMENTED'
        OR NOT module_enabled
        OR NOT EXISTS (SELECT 1 FROM sites_module_implementation WHERE code = module_code)
    ) THEN
        RAISE EXCEPTION 'A disabled or unimplemented module cannot be enabled for a Site.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_module_requires_usable';
    END IF;
    -- Retention is allowed only when disabling an existing assignment without
    -- editing its settings. Identity, lifecycle and dependency triggers remain.
    IF TG_OP = 'UPDATE' AND NOT NEW.is_enabled
       AND NEW.configuration IS NOT DISTINCT FROM OLD.configuration THEN
        RETURN NEW;
    END IF;
    PERFORM sites_validate_site_module_configuration(NEW.configuration, module_schema);
    RETURN NEW;
END;
$$;
"""

REVERSE = FUNCTION.replace(
    "    IF TG_OP = 'UPDATE' AND NOT NEW.is_enabled\n"
    "       AND NEW.configuration IS NOT DISTINCT FROM OLD.configuration THEN\n"
    "        RETURN NEW;\n"
    "    END IF;\n",
    "",
)


class Migration(migrations.Migration):
    dependencies = [("sites", "0009_module_integrity")]
    operations = [migrations.RunSQL(FUNCTION, reverse_sql=REVERSE)]
