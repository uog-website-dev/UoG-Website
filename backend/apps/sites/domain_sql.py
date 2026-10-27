"""Database rules for SiteDomain. Installed by sites.0003_sitedomain."""

FORWARD = r"""
CREATE FUNCTION sites_lock_domains() RETURNS void LANGUAGE sql AS $$
    SELECT pg_advisory_xact_lock(hashtext('sites.domain'));
$$;

CREATE FUNCTION sites_domain_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM sites_lock_domains();
    RETURN NULL;
END;
$$;

CREATE FUNCTION sites_enforce_domain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Domain identifiers cannot be changed.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_domain_immutable_id';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.hostname IS DISTINCT FROM OLD.hostname THEN
        RAISE EXCEPTION 'Hostnames cannot be changed.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_domain_immutable_hostname';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.site_id IS DISTINCT FROM OLD.site_id
       AND current_setting('sites.domain_reassignment', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'Move a domain with the reassignment operation.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_domain_reassignment';
    END IF;
    IF TG_OP = 'DELETE' AND (OLD.is_primary OR OLD.status IS DISTINCT FROM 'INACTIVE') THEN
        RAISE EXCEPTION 'Deactivate the domain and clear its primary designation before removing it.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_domain_no_delete';
    END IF;
    IF TG_OP <> 'DELETE' AND NEW.status = 'ACTIVE' AND EXISTS (
        SELECT 1 FROM sites_site WHERE id = NEW.site_id AND status = 'ARCHIVED'
    ) THEN
        RAISE EXCEPTION 'An archived Site cannot have an active domain.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_domain_archived_site';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER site_domain_serialization
BEFORE INSERT OR UPDATE OR DELETE ON sites_sitedomain
FOR EACH STATEMENT EXECUTE FUNCTION sites_domain_lock();

CREATE TRIGGER site_domain_rules
BEFORE INSERT OR UPDATE OR DELETE ON sites_sitedomain
FOR EACH ROW EXECUTE FUNCTION sites_enforce_domain();
"""

REVERSE = r"""
DROP TRIGGER site_domain_rules ON sites_sitedomain;
DROP TRIGGER site_domain_serialization ON sites_sitedomain;
DROP FUNCTION sites_enforce_domain();
DROP FUNCTION sites_domain_lock();
DROP FUNCTION sites_lock_domains();
"""
