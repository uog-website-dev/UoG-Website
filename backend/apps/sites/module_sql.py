"""Registry rules for sites.0005.

A module is usable only when its status is IMPLEMENTED, the global switch is
on, and sites_module_implementation contains its code. This story records no
implementation, so the seeded capabilities stay planned.
"""

FORWARD = r"""
CREATE TABLE sites_module_implementation (
    code varchar(64) PRIMARY KEY,
    CONSTRAINT module_implementation_code CHECK (code ~ '^[A-Z][A-Z0-9_-]{0,63}$')
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uog_app') THEN
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE sites_module_implementation FROM uog_app;
    END IF;
END $$;

CREATE FUNCTION sites_validate_module_schema(config jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    item jsonb; codes text[] := ARRAY[]::text[];
BEGIN
    IF jsonb_typeof(config) IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(config)) <> 2
       OR NOT (config ?& ARRAY['schema_version','properties'])
       OR sites_configuration_has_secret(config) THEN
        RAISE EXCEPTION 'Unsupported module configuration schema.'
            USING ERRCODE = '23514', CONSTRAINT = 'module_configuration_schema';
    END IF;
    IF jsonb_typeof(config->'schema_version') IS DISTINCT FROM 'number'
       OR config->>'schema_version' IS DISTINCT FROM '1'
       OR jsonb_typeof(config->'properties') IS DISTINCT FROM 'array'
       OR jsonb_array_length(config->'properties') > 30 THEN
        RAISE EXCEPTION 'Unsupported module configuration schema.'
            USING ERRCODE = '23514', CONSTRAINT = 'module_configuration_schema';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(config->'properties') AS value LOOP
        IF jsonb_typeof(item) IS DISTINCT FROM 'object'
           OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 4
           OR NOT (item ?& ARRAY['code','label','type','required'])
           OR item->>'code' !~ '^[A-Z][A-Z0-9_]{0,31}$'
           OR item->>'code' ~* '(password|secret|token|credential|api_key|private_key|session)'
           OR item->>'label' IS NULL OR char_length(item->>'label') NOT BETWEEN 1 AND 80
           OR (item->>'label') ~ '^\s|\s$'
           OR item->>'type' NOT IN ('boolean', 'string', 'integer')
           OR jsonb_typeof(item->'required') IS DISTINCT FROM 'boolean'
           OR item->>'code' = ANY(codes) THEN
            RAISE EXCEPTION 'Module configuration properties are not approved.'
                USING ERRCODE = '23514', CONSTRAINT = 'module_configuration_schema';
        END IF;
        codes := codes || (item->>'code');
    END LOOP;
END;
$$;

CREATE FUNCTION sites_enforce_module() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Modules cannot be deleted. Deprecate them instead.'
            USING ERRCODE = '23514', CONSTRAINT = 'module_no_delete';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.code IS DISTINCT FROM OLD.code THEN
        RAISE EXCEPTION 'Module codes cannot be changed.'
            USING ERRCODE = '23514', CONSTRAINT = 'module_immutable_code';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NOT (
        (OLD.status = 'PLANNED' AND NEW.status IN ('IMPLEMENTED', 'DEPRECATED'))
        OR (OLD.status = 'IMPLEMENTED' AND NEW.status = 'DEPRECATED')
        OR (OLD.status = 'DEPRECATED' AND NEW.status = 'IMPLEMENTED')
    ) THEN
        RAISE EXCEPTION 'That module status change is not allowed.'
            USING ERRCODE = '23514', CONSTRAINT = 'module_status_transition';
    END IF;
    IF NEW.status = 'IMPLEMENTED' AND NOT EXISTS (
        SELECT 1 FROM sites_module_implementation WHERE code = NEW.code
    ) THEN
        RAISE EXCEPTION 'This capability is not implemented.'
            USING ERRCODE = '23514', CONSTRAINT = 'module_requires_shipped_capability';
    END IF;
    IF NEW.is_enabled AND NEW.status IS DISTINCT FROM 'IMPLEMENTED' THEN
        RAISE EXCEPTION 'Only an implemented module can be enabled.'
            USING ERRCODE = '23514', CONSTRAINT = 'module_enabled_requires_implemented';
    END IF;
    PERFORM sites_validate_module_schema(NEW.configuration_schema);
    RETURN NEW;
END;
$$;

CREATE TRIGGER module_registry_rules
BEFORE INSERT OR UPDATE OR DELETE ON sites_module
FOR EACH ROW EXECUTE FUNCTION sites_enforce_module();

CREATE FUNCTION sites_enforce_site_module() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    module_status text;
    module_enabled boolean;
    module_code text;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.module_id IS NOT DISTINCT FROM OLD.module_id AND NEW.site_id IS NOT DISTINCT FROM OLD.site_id THEN
        RETURN NEW;
    END IF;
    SELECT status, is_enabled, code INTO module_status, module_enabled, module_code
    FROM sites_module WHERE id = NEW.module_id;
    IF module_status IS DISTINCT FROM 'IMPLEMENTED' OR NOT module_enabled OR NOT EXISTS (
        SELECT 1 FROM sites_module_implementation WHERE code = module_code
    ) THEN
        RAISE EXCEPTION 'A disabled or unimplemented module cannot be enabled for a Site.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_module_requires_usable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER site_module_selection
BEFORE INSERT OR UPDATE ON sites_sitemodule
FOR EACH ROW EXECUTE FUNCTION sites_enforce_site_module();
"""

REVERSE = r"""
DROP TRIGGER site_module_selection ON sites_sitemodule;
DROP FUNCTION sites_enforce_site_module();
DROP TRIGGER module_registry_rules ON sites_module;
DROP FUNCTION sites_enforce_module();
DROP FUNCTION sites_validate_module_schema(jsonb);
DROP TABLE sites_module_implementation;
"""
