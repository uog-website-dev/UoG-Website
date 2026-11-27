"""Allow hero-style title banner patterns (heritage, diamonds, diagonal, chevron-field)."""

from django.db import migrations

# Keep in lockstep with apps.sites.banner.BANNER_PATTERNS and TitleBannerPattern.
VALIDATE_PATTERNS = r"""
CREATE OR REPLACE FUNCTION sites_validate_configuration(config jsonb, default_language text)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    item jsonb; lang text; ref text; nav_codes text[] := ARRAY[]::text[];
    banner jsonb; slot text; style jsonb;
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
       OR config->>'schema_version' NOT IN ('1', '2') THEN
        RAISE EXCEPTION 'Unsupported configuration schema_version.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_configuration_schema';
    END IF;
    IF config->>'schema_version' = '1' THEN
        IF jsonb_typeof(config->'presentation') IS DISTINCT FROM 'object'
           OR (SELECT count(*) FROM jsonb_object_keys(config->'presentation')) <> 1
           OR config->'presentation'->>'theme' IS NULL
           OR config->'presentation'->>'theme' NOT IN ('institutional', 'high-contrast') THEN
            RAISE EXCEPTION 'Presentation theme is not approved.'
                USING ERRCODE = '23514', CONSTRAINT = 'site_configuration_schema';
        END IF;
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
    IF config->>'schema_version' = '2' THEN
        IF jsonb_typeof(config->'presentation') IS DISTINCT FROM 'object'
           OR (SELECT count(*) FROM jsonb_object_keys(config->'presentation')) <> 2
           OR config->'presentation'->>'theme' IS NULL
           OR config->'presentation'->>'theme' NOT IN ('institutional', 'high-contrast')
           OR NOT ((config->'presentation') ? 'banner') THEN
            RAISE EXCEPTION 'Presentation theme is not approved.'
                USING ERRCODE = '23514', CONSTRAINT = 'site_configuration_schema';
        END IF;
        banner := config->'presentation'->'banner';
        IF jsonb_typeof(banner) IS DISTINCT FROM 'object'
           OR (SELECT count(*) FROM jsonb_object_keys(banner)) <> 4
           OR NOT (banner ?& ARRAY['scope','shared','page','post'])
           OR banner->>'scope' NOT IN ('shared','independent') THEN
            RAISE EXCEPTION 'Configuration presentation.banner does not match the approved schema.'
                USING ERRCODE = '23514', CONSTRAINT = 'site_configuration_schema';
        END IF;
        FOREACH slot IN ARRAY ARRAY['shared','page','post'] LOOP
            style := banner->slot;
            IF jsonb_typeof(style) IS DISTINCT FROM 'object'
               OR (SELECT count(*) FROM jsonb_object_keys(style)) <> 12
               OR NOT (style ?& ARRAY['enabled','background_type','image_ref','pattern','background_color','overlay_color','overlay_opacity','height','title_color','title_align','content_position','padding_y'])
               OR jsonb_typeof(style->'enabled') IS DISTINCT FROM 'boolean'
               OR style->>'background_type' NOT IN ('color','image','pattern')
               OR style->>'pattern' NOT IN (
                    'geometric-grid','geometric-dots','abstract-waves','gradient-navy','gradient-gold',
                    'minimal-lines','minimal-solid','heritage','diamonds','diagonal','chevron-field'
               )
               OR style->>'background_color' !~ '^#[0-9a-fA-F]{6}$'
               OR style->>'overlay_color' !~ '^#[0-9a-fA-F]{6}$'
               OR style->>'title_color' !~ '^#[0-9a-fA-F]{6}$'
               OR style->>'height' NOT IN ('sm','md','lg')
               OR style->>'title_align' NOT IN ('left','center','right')
               OR style->>'content_position' NOT IN ('top','center','bottom')
               OR style->>'padding_y' NOT IN ('sm','md','lg')
               OR jsonb_typeof(style->'overlay_opacity') IS DISTINCT FROM 'number'
               OR (style->>'overlay_opacity')::float < 0
               OR (style->>'overlay_opacity')::float > 0.85
               OR (
                    jsonb_typeof(style->'image_ref') IS DISTINCT FROM 'null'
                    AND (
                        jsonb_typeof(style->'image_ref') IS DISTINCT FROM 'string'
                        OR (style->>'image_ref') !~ '^[a-z0-9][a-z0-9_-]{0,127}$'
                    )
               ) THEN
                RAISE EXCEPTION 'Configuration presentation.banner does not match the approved schema.'
                    USING ERRCODE = '23514', CONSTRAINT = 'site_configuration_schema';
            END IF;
        END LOOP;
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
"""


class Migration(migrations.Migration):
    dependencies = [
        ("sites", "0019_title_banner_configuration"),
    ]

    operations = [
        migrations.RunSQL(sql=VALIDATE_PATTERNS, reverse_sql=migrations.RunSQL.noop),
    ]
