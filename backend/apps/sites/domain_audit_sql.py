"""Primary-domain deactivation guard and shared audit for SiteDomain.

Installed by sites.0007_sitedomain_audit. sites.0003_sitedomain stays frozen.
"""

FORWARD = r"""
CREATE OR REPLACE FUNCTION sites_enforce_domain() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF TG_OP = 'UPDATE' AND OLD.is_primary AND OLD.status = 'ACTIVE' AND NEW.status IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION 'Select an active domain on this Site before deactivating the primary.'
            USING ERRCODE = '23514', CONSTRAINT = 'site_domain_primary_deactivate';
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

CREATE FUNCTION sites_domain_snapshot(domain_row sites_sitedomain) RETURNS jsonb LANGUAGE sql AS $$
    SELECT jsonb_build_object(
        'site_id', domain_row.site_id,
        'hostname', domain_row.hostname,
        'is_primary', domain_row.is_primary,
        'redirect_to_primary', domain_row.redirect_to_primary,
        'status', domain_row.status
    );
$$;

CREATE FUNCTION sites_audit_domain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    event_action text;
    fields jsonb;
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM audit_record_event(
            'SITE_DOMAIN_CREATED', 'sites.sitedomain', NEW.id::text, NULL,
            sites_domain_snapshot(NEW),
            '["hostname","is_primary","redirect_to_primary","site_id","status"]'::jsonb);
        RETURN NEW;
    END IF;
    SELECT coalesce(jsonb_agg(field ORDER BY field), '[]'::jsonb) INTO fields
    FROM (VALUES
        ('hostname', OLD.hostname IS DISTINCT FROM NEW.hostname),
        ('is_primary', OLD.is_primary IS DISTINCT FROM NEW.is_primary),
        ('redirect_to_primary', OLD.redirect_to_primary IS DISTINCT FROM NEW.redirect_to_primary),
        ('site_id', OLD.site_id IS DISTINCT FROM NEW.site_id),
        ('status', OLD.status IS DISTINCT FROM NEW.status)
    ) AS changed(field, differs)
    WHERE differs;
    IF fields = '[]'::jsonb THEN
        RETURN NEW;
    END IF;
    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'INACTIVE' THEN
        event_action := 'SITE_DOMAIN_DEACTIVATED';
    ELSIF OLD.is_primary IS DISTINCT FROM NEW.is_primary THEN
        event_action := 'SITE_DOMAIN_PRIMARY_CHANGED';
    ELSE
        event_action := 'SITE_DOMAIN_UPDATED';
    END IF;
    PERFORM audit_record_event(
        event_action, 'sites.sitedomain', NEW.id::text,
        sites_domain_snapshot(OLD), sites_domain_snapshot(NEW), fields);
    RETURN NEW;
END;
$$;

CREATE TRIGGER site_domain_audit
AFTER INSERT OR UPDATE ON sites_sitedomain
FOR EACH ROW EXECUTE FUNCTION sites_audit_domain();
"""

REVERSE = r"""
DROP TRIGGER site_domain_audit ON sites_sitedomain;
DROP FUNCTION sites_audit_domain();
DROP FUNCTION sites_domain_snapshot(sites_sitedomain);

CREATE OR REPLACE FUNCTION sites_enforce_domain() RETURNS trigger LANGUAGE plpgsql AS $$
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
"""
