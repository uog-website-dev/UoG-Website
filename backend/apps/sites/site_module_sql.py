"""Per-site enablement rules added after the registry trigger."""

FORWARD = r"""
CREATE FUNCTION sites_validate_site_module_configuration(config jsonb, schema jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    prop jsonb;
    key text;
    expected_type text;
    allowed_codes text[] := ARRAY[]::text[];
    required_codes text[] := ARRAY[]::text[];
BEGIN
    IF jsonb_typeof(config) IS DISTINCT FROM 'object' OR sites_configuration_has_secret(config) THEN
        RAISE EXCEPTION 'Site module configuration is not approved.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_module_configuration';
    END IF;
    FOR prop IN SELECT value FROM jsonb_array_elements(COALESCE(schema->'properties', '[]'::jsonb)) AS value LOOP
        allowed_codes := allowed_codes || (prop->>'code');
        IF COALESCE((prop->>'required')::boolean, false) THEN
            required_codes := required_codes || (prop->>'code');
        END IF;
    END LOOP;
    FOR key IN SELECT jsonb_object_keys(config) LOOP
        IF NOT (key = ANY(allowed_codes)) THEN
            RAISE EXCEPTION 'Site module configuration is not approved.'
                USING ERRCODE = '23514', CONSTRAINT = 'site_module_configuration';
        END IF;
        SELECT item->>'type' INTO expected_type
        FROM jsonb_array_elements(schema->'properties') AS item
        WHERE item->>'code' = key;
        IF expected_type = 'boolean' AND jsonb_typeof(config->key) IS DISTINCT FROM 'boolean'
           OR expected_type = 'string' AND (
                jsonb_typeof(config->key) IS DISTINCT FROM 'string'
                OR char_length(config->>key) NOT BETWEEN 1 AND 500
                OR (config->>key) ~ '^\s|\s$'
           )
           OR expected_type = 'integer' AND (
                jsonb_typeof(config->key) IS DISTINCT FROM 'number'
                OR (config->>key) !~ '^-?[0-9]+$'
           ) THEN
            RAISE EXCEPTION 'Site module configuration is not approved.'
                USING ERRCODE = '23514', CONSTRAINT = 'site_module_configuration';
        END IF;
    END LOOP;
    IF EXISTS (
        SELECT 1 FROM unnest(required_codes) AS required(code)
        WHERE NOT (config ? required.code)
    ) THEN
        RAISE EXCEPTION 'Site module configuration is missing a required property.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_module_configuration';
    END IF;
END;
$$;

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
    PERFORM sites_validate_site_module_configuration(NEW.configuration, module_schema);
    RETURN NEW;
END;
$$;
"""

REVERSE = r"""
CREATE OR REPLACE FUNCTION sites_enforce_site_module() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
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

DROP FUNCTION sites_validate_site_module_configuration(jsonb, jsonb);
"""
