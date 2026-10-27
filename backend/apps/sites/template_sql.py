"""Template schema checks and selection rules for sites.0004.

Selecting a template never rewrites an existing Site. Provisioning does not
enable modules.
"""

FORWARD = r"""
CREATE FUNCTION sites_enforce_template() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    reference_language text;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Template identifiers cannot be changed.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_template_immutable_id';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.code IS DISTINCT FROM OLD.code THEN
        RAISE EXCEPTION 'Template codes cannot be changed.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_template_immutable_code';
    END IF;
    reference_language := NEW.default_configuration->'language'->'enabled'->>0;
    IF reference_language IS NULL THEN
        reference_language := 'en-us';
    END IF;
    PERFORM sites_validate_configuration(NEW.default_configuration, reference_language);
    RETURN NEW;
END;
$$;

CREATE TRIGGER site_template_rules
BEFORE INSERT OR UPDATE ON sites_sitetemplate
FOR EACH ROW EXECUTE FUNCTION sites_enforce_template();

CREATE FUNCTION sites_enforce_template_selection() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    template_status text;
BEGIN
    IF NEW.template_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.template_id IS NOT DISTINCT FROM OLD.template_id THEN
        RETURN NEW;
    END IF;
    SELECT status INTO template_status FROM sites_sitetemplate WHERE id = NEW.template_id;
    IF template_status IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION 'An inactive template cannot be selected for a new Site.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_template_selectable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER site_template_selection
BEFORE INSERT OR UPDATE ON sites_site
FOR EACH ROW EXECUTE FUNCTION sites_enforce_template_selection();
"""

REVERSE = r"""
DROP TRIGGER site_template_selection ON sites_site;
DROP FUNCTION sites_enforce_template_selection();
DROP TRIGGER site_template_rules ON sites_sitetemplate;
DROP FUNCTION sites_enforce_template();
"""
