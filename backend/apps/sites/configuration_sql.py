"""Schema envelope, typed checks and configuration audit for sites.0002."""

FORWARD = r"""
CREATE FUNCTION sites_configuration_has_secret(node jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE jsonb_typeof(node)
        WHEN 'object' THEN EXISTS (
            SELECT 1 FROM jsonb_each(node) AS entry(key, value)
            WHERE entry.key ~* '(password|secret|token|credential|api_key|private_key|session)'
               OR sites_configuration_has_secret(entry.value))
        WHEN 'array' THEN EXISTS (
            SELECT 1 FROM jsonb_array_elements(node) AS entry(value)
            WHERE sites_configuration_has_secret(entry.value))
        ELSE FALSE
    END;
$$;

CREATE FUNCTION sites_validate_configuration(config jsonb, default_language text)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    item jsonb; lang text; ref text; nav_codes text[] := ARRAY[]::text[];
BEGIN
    IF jsonb_typeof(config) IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(config)) <> 6
       OR NOT (config ?& ARRAY['schema_version','identity','language','presentation','navigation','behavior'])
    THEN
        RAISE EXCEPTION 'Configuration contains unsupported properties.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_configuration_schema';
    END IF;
    IF sites_configuration_has_secret(config) THEN
        RAISE EXCEPTION 'Site configuration cannot store secrets.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_configuration_schema';
    END IF;
    IF jsonb_typeof(config->'schema_version') IS DISTINCT FROM 'number'
       OR config->>'schema_version' IS DISTINCT FROM '1' THEN
        RAISE EXCEPTION 'Unsupported configuration schema_version.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_configuration_schema';
    END IF;
    IF jsonb_typeof(config->'identity') IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(config->'identity')) <> 3
       OR NOT ((config->'identity') ?& ARRAY['display_name','logo_ref','favicon_ref']) THEN
        RAISE EXCEPTION 'Configuration identity does not match the approved schema.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_configuration_schema';
    END IF;
    IF jsonb_typeof(config->'identity'->'display_name') IS DISTINCT FROM 'null' AND (
        jsonb_typeof(config->'identity'->'display_name') IS DISTINCT FROM 'string'
        OR char_length(config->'identity'->>'display_name') NOT BETWEEN 1 AND 255
        OR (config->'identity'->>'display_name') ~ '^\s|\s$'
    ) THEN
        RAISE EXCEPTION 'Identity display_name must be null or a nonblank name.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_configuration_schema';
    END IF;
    FOREACH ref IN ARRAY ARRAY['logo_ref','favicon_ref'] LOOP
        IF jsonb_typeof(config->'identity'->ref) IS DISTINCT FROM 'null' AND (
            jsonb_typeof(config->'identity'->ref) IS DISTINCT FROM 'string'
            OR (config->'identity'->>ref) !~ '^[a-z0-9][a-z0-9_-]{0,127}$'
        ) THEN
            RAISE EXCEPTION 'Media references must be null or a future media key.'
                USING ERRCODE = '23514', CONSTRAINT = 'site_configuration_schema';
        END IF;
    END LOOP;
    IF jsonb_typeof(config->'language') IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(config->'language')) <> 1
       OR NOT ((config->'language') ? 'enabled')
       OR jsonb_typeof(config->'language'->'enabled') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Configuration language does not match the approved schema.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_configuration_schema';
    END IF;
    IF jsonb_array_length(config->'language'->'enabled') NOT BETWEEN 1 AND 10 THEN
        RAISE EXCEPTION 'Enabled languages must include the Site default language.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_configuration_schema';
    END IF;
    FOR lang IN SELECT value FROM jsonb_array_elements_text(config->'language'->'enabled') AS value LOOP
        IF lang !~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$' THEN
            RAISE EXCEPTION 'Enabled languages must include the Site default language.'
                USING ERRCODE = '23514', CONSTRAINT = 'site_configuration_schema';
        END IF;
    END LOOP;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(config->'language'->'enabled') AS value
        GROUP BY value HAVING count(*) > 1
    ) OR NOT (config->'language'->'enabled' ? default_language) THEN
        RAISE EXCEPTION 'Enabled languages must include the Site default language.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_configuration_schema';
    END IF;
    IF jsonb_typeof(config->'presentation') IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(config->'presentation')) <> 1
       OR config->'presentation'->>'theme' IS NULL
       OR config->'presentation'->>'theme' NOT IN ('institutional', 'high-contrast') THEN
        RAISE EXCEPTION 'Presentation theme is not approved.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_configuration_schema';
    END IF;
    IF jsonb_typeof(config->'navigation') IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(config->'navigation')) <> 1
       OR jsonb_typeof(config->'navigation'->'items') IS DISTINCT FROM 'array'
       OR jsonb_array_length(config->'navigation'->'items') > 20 THEN
        RAISE EXCEPTION 'Navigation items do not match the approved schema.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_configuration_schema';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(config->'navigation'->'items') AS value LOOP
        IF jsonb_typeof(item) IS DISTINCT FROM 'object'
           OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 3
           OR NOT (item ?& ARRAY['code','label','path'])
           OR item->>'code' !~ '^[A-Z][A-Z0-9_-]{0,31}$'
           OR item->>'label' IS NULL OR char_length(item->>'label') NOT BETWEEN 1 AND 80
           OR (item->>'label') ~ '^\s|\s$'
           OR item->>'path' !~ '^/([a-z0-9][a-z0-9_-]{0,63}(/[a-z0-9][a-z0-9_-]{0,63})*)?$'
           OR item->>'code' = ANY(nav_codes) THEN
            RAISE EXCEPTION 'Navigation items do not match the approved schema.'
                USING ERRCODE = '23514', CONSTRAINT = 'site_configuration_schema';
        END IF;
        nav_codes := nav_codes || (item->>'code');
    END LOOP;
    IF jsonb_typeof(config->'behavior') IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(config->'behavior')) <> 2
       OR NOT ((config->'behavior') ?& ARRAY['show_search','show_language_switcher'])
       OR jsonb_typeof(config->'behavior'->'show_search') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(config->'behavior'->'show_language_switcher') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION 'Behavior settings must be boolean.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_configuration_schema';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sites_enforce_lifecycle() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Sites cannot be deleted. Suspend or archive them instead.' USING ERRCODE='23514', CONSTRAINT='site_no_delete';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Site identifiers cannot be changed.' USING ERRCODE='23514', CONSTRAINT='site_immutable_id';
    END IF;
    PERFORM sites_validate_lifecycle(NEW.id, NEW.code, NEW.organization_unit_id, NEW.status, NEW.is_main);
    PERFORM sites_validate_configuration(NEW.configuration, NEW.default_language);
    RETURN NEW;
END;
$$;

CREATE FUNCTION sites_audit_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fields jsonb;
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM audit_record_event(
            'SITE_CONFIGURATION_CREATED', 'sites.site', NEW.id::text, NULL, NEW.configuration,
            '["behavior","identity","language","navigation","presentation","schema_version"]'::jsonb);
        RETURN NEW;
    END IF;
    IF NEW.configuration IS NOT DISTINCT FROM OLD.configuration THEN
        RETURN NEW;
    END IF;
    SELECT coalesce(jsonb_agg(key ORDER BY key), '[]'::jsonb) INTO fields
    FROM jsonb_object_keys(NEW.configuration) AS key
    WHERE NEW.configuration->key IS DISTINCT FROM OLD.configuration->key;
    PERFORM audit_record_event(
        'SITE_CONFIGURATION_UPDATED', 'sites.site', NEW.id::text, OLD.configuration, NEW.configuration, fields);
    RETURN NEW;
END;
$$;

CREATE TRIGGER site_configuration_audit
AFTER INSERT OR UPDATE ON sites_site
FOR EACH ROW EXECUTE FUNCTION sites_audit_configuration();
"""

REVERSE = r"""
DROP TRIGGER site_configuration_audit ON sites_site;
DROP FUNCTION sites_audit_configuration();
DROP FUNCTION sites_validate_configuration(jsonb, text);
DROP FUNCTION sites_configuration_has_secret(jsonb);

CREATE OR REPLACE FUNCTION sites_enforce_lifecycle() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Sites cannot be deleted. Suspend or archive them instead.' USING ERRCODE='23514', CONSTRAINT='site_no_delete';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Site identifiers cannot be changed.' USING ERRCODE='23514', CONSTRAINT='site_immutable_id';
    END IF;
    PERFORM sites_validate_lifecycle(NEW.id, NEW.code, NEW.organization_unit_id, NEW.status, NEW.is_main);
    RETURN NEW;
END;
$$;
"""
