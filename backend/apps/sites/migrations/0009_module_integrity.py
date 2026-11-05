"""Serialize all module writers and enforce dependency integrity below services."""
from django.db import migrations


FORWARD = r"""
CREATE TRIGGER module_management_guard BEFORE INSERT OR UPDATE OR DELETE ON sites_module
FOR EACH STATEMENT EXECUTE FUNCTION organizations_serialize_hierarchy();
CREATE TRIGGER site_module_management_guard BEFORE INSERT OR UPDATE OR DELETE ON sites_sitemodule
FOR EACH STATEMENT EXECUTE FUNCTION organizations_serialize_hierarchy();
CREATE TRIGGER module_dependency_guard BEFORE INSERT OR UPDATE OR DELETE ON sites_moduledependency
FOR EACH STATEMENT EXECUTE FUNCTION organizations_serialize_hierarchy();

CREATE FUNCTION sites_check_module_dependencies() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
    IF TG_TABLE_NAME = 'sites_moduledependency' THEN
        IF NEW.module_id = NEW.requires_id OR EXISTS (
            WITH RECURSIVE reachable(id) AS (
                SELECT NEW.requires_id
                UNION
                SELECT d.requires_id FROM sites_moduledependency d JOIN reachable r ON d.module_id = r.id
                WHERE d.id IS DISTINCT FROM NEW.id
            ) SELECT 1 FROM reachable WHERE id = NEW.module_id
        ) THEN
            RAISE EXCEPTION 'Module dependencies cannot contain cycles.'
                USING ERRCODE = '23514', CONSTRAINT = 'module_dependency_cycle';
        END IF;
        IF EXISTS (
            SELECT 1 FROM sites_sitemodule dependent
            WHERE dependent.module_id = NEW.module_id AND dependent.is_enabled
            AND NOT EXISTS (SELECT 1 FROM sites_sitemodule required
                WHERE required.site_id = dependent.site_id AND required.module_id = NEW.requires_id AND required.is_enabled)
        ) THEN
            RAISE EXCEPTION 'Enable the required module on existing dependent Sites first.'
                USING ERRCODE = '23514', CONSTRAINT = 'module_dependency_existing_sites';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.is_enabled IS NOT DISTINCT FROM OLD.is_enabled THEN
        RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM sites_site WHERE id = NEW.site_id AND status = 'ARCHIVED') THEN
        RAISE EXCEPTION 'Archived Sites are frozen.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_module_archived';
    END IF;
    IF NEW.is_enabled AND EXISTS (
        SELECT 1 FROM sites_moduledependency d JOIN sites_module m ON m.id = d.requires_id
        WHERE d.module_id = NEW.module_id AND (
            m.status <> 'IMPLEMENTED' OR NOT m.is_enabled
            OR NOT EXISTS (SELECT 1 FROM sites_module_implementation WHERE code = m.code)
            OR NOT EXISTS (SELECT 1 FROM sites_sitemodule required
                WHERE required.site_id = NEW.site_id AND required.module_id = m.id AND required.is_enabled)
        )
    ) THEN
        RAISE EXCEPTION 'A required module is not available for this Site.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_module_missing_dependency';
    END IF;
    IF NOT NEW.is_enabled AND EXISTS (
        SELECT 1 FROM sites_moduledependency d JOIN sites_sitemodule dependent ON dependent.module_id = d.module_id
        WHERE d.requires_id = NEW.module_id AND dependent.site_id = NEW.site_id AND dependent.is_enabled
    ) THEN
        RAISE EXCEPTION 'An enabled module requires this module. Disable the dependent first.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_module_required_by';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER module_dependency_rules BEFORE INSERT OR UPDATE ON sites_moduledependency
FOR EACH ROW EXECUTE FUNCTION sites_check_module_dependencies();
CREATE TRIGGER site_module_dependency_rules BEFORE INSERT OR UPDATE ON sites_sitemodule
FOR EACH ROW EXECUTE FUNCTION sites_check_module_dependencies();
"""

REVERSE = r"""
DROP TRIGGER site_module_dependency_rules ON sites_sitemodule;
DROP TRIGGER module_dependency_rules ON sites_moduledependency;
DROP FUNCTION sites_check_module_dependencies();
DROP TRIGGER module_dependency_guard ON sites_moduledependency;
DROP TRIGGER site_module_management_guard ON sites_sitemodule;
DROP TRIGGER module_management_guard ON sites_module;
"""


class Migration(migrations.Migration):
    dependencies = [("sites", "0008_module_operations")]
    operations = [migrations.RunSQL(FORWARD, reverse_sql=REVERSE)]
