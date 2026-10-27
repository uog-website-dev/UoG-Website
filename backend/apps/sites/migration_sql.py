"""Frozen SQL for 0001_initial: Site/Organization lifecycle integration.

Keep these definitions unchanged once deployed; use new migrations for
subsequent changes. Creation of the table and these rules is one atomic migration.
"""

FORWARD = """
SELECT organizations_lock_hierarchy();
LOCK TABLE sites_site IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION organizations_has_active_sites(unit_ids bigint[])
RETURNS boolean LANGUAGE sql VOLATILE AS $$
    SELECT EXISTS(SELECT 1 FROM sites_site WHERE organization_unit_id = ANY(unit_ids) AND status = 'ACTIVE');
$$;

CREATE FUNCTION sites_validate_lifecycle(site_id bigint, site_code text, owner_id bigint, new_status text, main_site boolean)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
DECLARE previous sites_site%ROWTYPE; existed boolean; owner_status text; owner_parent bigint; owner_type text;
BEGIN
    SELECT * INTO previous FROM sites_site WHERE id = site_id;
    existed := FOUND;
    SELECT u.status, u.parent_id, t.code INTO owner_status, owner_parent, owner_type
        FROM organizations_organizationunit u JOIN organizations_organizationtype t ON t.id = u.organization_type_id
        WHERE u.id = owner_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The owning OrganizationUnit does not exist.' USING ERRCODE='23503', CONSTRAINT='site_owner_valid';
    END IF;
    IF existed AND previous.code IS DISTINCT FROM site_code THEN
        RAISE EXCEPTION 'Site codes cannot be changed.' USING ERRCODE='23514', CONSTRAINT='site_immutable_code';
    END IF;
    IF NOT existed AND new_status IS DISTINCT FROM 'DRAFT' THEN
        RAISE EXCEPTION 'New Sites must start DRAFT.' USING ERRCODE='23514', CONSTRAINT='site_lifecycle_status';
    END IF;
    IF existed AND new_status IS DISTINCT FROM previous.status AND NOT (
        (previous.status = 'DRAFT' AND new_status IN ('ACTIVE', 'ARCHIVED')) OR
        (previous.status = 'ACTIVE' AND new_status IN ('SUSPENDED', 'ARCHIVED')) OR
        (previous.status = 'SUSPENDED' AND new_status IN ('ACTIVE', 'ARCHIVED'))
    ) THEN
        RAISE EXCEPTION 'This Site lifecycle transition is not allowed.' USING ERRCODE='23514', CONSTRAINT='site_lifecycle_status';
    END IF;
    IF existed AND previous.status = 'ARCHIVED' AND (
        owner_id IS DISTINCT FROM previous.organization_unit_id OR main_site IS DISTINCT FROM previous.is_main
    ) THEN
        RAISE EXCEPTION 'Archived Site ownership and main designation cannot be changed.' USING ERRCODE='23514', CONSTRAINT='site_archived_structure';
    END IF;
    IF new_status = 'ACTIVE' AND owner_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'An ACTIVE Site requires an ACTIVE OrganizationUnit.' USING ERRCODE='23514', CONSTRAINT='site_active_owner';
    END IF;
    IF (NOT existed OR owner_id IS DISTINCT FROM previous.organization_unit_id) AND owner_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'New Site ownership requires an ACTIVE OrganizationUnit.' USING ERRCODE='23514', CONSTRAINT='site_new_owner';
    END IF;
    IF main_site AND (owner_parent IS NOT NULL OR owner_type <> 'UNIVERSITY') THEN
        RAISE EXCEPTION 'The main university Site must belong to the UNIVERSITY root.' USING ERRCODE='23514', CONSTRAINT='site_main_owner';
    END IF;
END;
$$;

CREATE FUNCTION sites_enforce_lifecycle() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
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

CREATE TRIGGER site_serialization BEFORE INSERT OR UPDATE OR DELETE ON sites_site
FOR EACH STATEMENT EXECUTE FUNCTION organizations_serialize_hierarchy();
CREATE TRIGGER site_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON sites_site
FOR EACH ROW EXECUTE FUNCTION sites_enforce_lifecycle();

-- Refuse invalid pre-existing data instead of silently changing ownership/state.
DO $$
DECLARE entry record;
BEGIN
    FOR entry IN SELECT id, code, organization_unit_id, status, is_main FROM sites_site LOOP
        PERFORM sites_validate_lifecycle(entry.id, entry.code, entry.organization_unit_id, entry.status, entry.is_main);
    END LOOP;
END;
$$;
"""

REVERSE = """
SELECT organizations_lock_hierarchy();
DROP TRIGGER site_lifecycle ON sites_site;
DROP TRIGGER site_serialization ON sites_site;
DROP FUNCTION sites_enforce_lifecycle();
DROP FUNCTION sites_validate_lifecycle(bigint, text, bigint, text, boolean);
CREATE OR REPLACE FUNCTION organizations_has_active_sites(unit_ids bigint[])
RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
BEGIN
    IF to_regclass('sites_site') IS NOT NULL THEN
        RAISE EXCEPTION 'Site lifecycle integration must be configured before changing organization lifecycle.'
            USING ERRCODE='23514', CONSTRAINT='organization_lifecycle_sites';
    END IF;
    RETURN FALSE;
END;
$$;
"""


