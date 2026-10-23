"""Forward-only lifecycle, protected University root, and archive-not-delete policy."""
from django.db import migrations, models


SITE_HOOK = """
CREATE FUNCTION organizations_has_active_sites(unit_ids bigint[])
RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
BEGIN
    -- Sites does not exist yet. Its migration must replace this hook with
    -- its own active-Site query and serialize Site writes with the guard.
    -- Fail closed if the conventional Site table appears without wiring.
    IF to_regclass('sites_site') IS NOT NULL THEN
        RAISE EXCEPTION 'Site lifecycle integration must be configured before changing organization lifecycle.'
            USING ERRCODE = '23514', CONSTRAINT = 'organization_lifecycle_sites';
    END IF;
    RETURN FALSE;
END;
$$;
"""

RULES = """
CREATE FUNCTION organizations_validate_unit_lifecycle(
    unit_id bigint, type_id bigint, new_parent_id bigint, new_status text
)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    previous organizations_organizationunit%ROWTYPE;
    existed boolean;
    type_code text;
    subtree_ids bigint[];
    active_descendants boolean;
BEGIN
    SELECT * INTO previous FROM organizations_organizationunit WHERE id = unit_id;
    existed := FOUND;
    SELECT code INTO type_code FROM organizations_organizationtype WHERE id = type_id;

    IF new_parent_id IS NULL THEN
        IF type_code IS DISTINCT FROM 'UNIVERSITY' OR new_status IS DISTINCT FROM 'ACTIVE' THEN
            RAISE EXCEPTION 'The root must be an ACTIVE UNIVERSITY unit.'
                USING ERRCODE = '23514', CONSTRAINT = 'organization_lifecycle_root';
        END IF;
    ELSIF type_code = 'UNIVERSITY' THEN
        RAISE EXCEPTION 'A UNIVERSITY unit must be the single root.'
            USING ERRCODE = '23514', CONSTRAINT = 'organization_lifecycle_type';
    END IF;

    IF existed AND previous.parent_id IS NULL AND (
        new_parent_id IS NOT NULL OR type_id IS DISTINCT FROM previous.organization_type_id
        OR new_status IS DISTINCT FROM 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'The University root cannot be moved, retyped, deactivated or archived.'
            USING ERRCODE = '23514', CONSTRAINT = 'organization_lifecycle_root';
    END IF;

    IF NOT existed AND new_status IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION 'New organization units must start ACTIVE.'
            USING ERRCODE = '23514', CONSTRAINT = 'organization_lifecycle_status';
    END IF;

    IF existed AND new_status IS DISTINCT FROM previous.status AND NOT (
        (previous.status = 'ACTIVE' AND new_status = 'INACTIVE') OR
        (previous.status = 'INACTIVE' AND new_status = 'ARCHIVED')
    ) THEN
        RAISE EXCEPTION 'Allowed transitions are ACTIVE to INACTIVE and INACTIVE to ARCHIVED.'
            USING ERRCODE = '23514', CONSTRAINT = 'organization_lifecycle_status';
    END IF;

    IF existed AND previous.status = 'ARCHIVED' AND (
        new_parent_id IS DISTINCT FROM previous.parent_id OR
        type_id IS DISTINCT FROM previous.organization_type_id
    ) THEN
        RAISE EXCEPTION 'Archived units cannot be moved or retyped.'
            USING ERRCODE = '23514', CONSTRAINT = 'organization_lifecycle_archived_structure';
    END IF;

    IF new_parent_id IS NOT NULL AND EXISTS (
        WITH RECURSIVE ancestors(id, parent_id, status) AS (
            SELECT id, parent_id, status FROM organizations_organizationunit WHERE id = new_parent_id
            UNION
            SELECT u.id, u.parent_id, u.status FROM organizations_organizationunit u
            JOIN ancestors a ON u.id = a.parent_id
        )
        SELECT 1 FROM ancestors WHERE
            (new_status = 'ACTIVE' AND status <> 'ACTIVE') OR
            ((NOT existed OR new_parent_id IS DISTINCT FROM previous.parent_id) AND status = 'ARCHIVED')
    ) THEN
        RAISE EXCEPTION 'Active units require active ancestors; new parent links cannot enter archived structure.'
            USING ERRCODE = '23514', CONSTRAINT = 'organization_lifecycle_parent';
    END IF;

    IF new_status IN ('INACTIVE', 'ARCHIVED') THEN
        WITH RECURSIVE subtree(id) AS (
            SELECT unit_id
            UNION
            SELECT u.id FROM organizations_organizationunit u JOIN subtree s ON u.parent_id = s.id
        )
        SELECT array_agg(u.id), COALESCE(bool_or(u.status = 'ACTIVE' AND u.id <> unit_id), FALSE)
            INTO subtree_ids, active_descendants
        FROM subtree s JOIN organizations_organizationunit u ON u.id = s.id;
        IF active_descendants THEN
            RAISE EXCEPTION 'Deactivate active descendants before deactivating or archiving their parent.'
                USING ERRCODE = '23514', CONSTRAINT = 'organization_lifecycle_descendants';
        END IF;
        IF organizations_has_active_sites(COALESCE(subtree_ids, ARRAY[]::bigint[])) THEN
            RAISE EXCEPTION 'Deactivate linked active Sites in this subtree before changing organization lifecycle.'
                USING ERRCODE = '23514', CONSTRAINT = 'organization_lifecycle_sites';
        END IF;
    END IF;
END;
$$;

-- Validate existing records before enabling the new rules. Invalid legacy
-- roots or active-descendant states require deliberate repair, not rewriting.
DO $$
DECLARE unit_row record;
BEGIN
    FOR unit_row IN SELECT id, organization_type_id, parent_id, status FROM organizations_organizationunit LOOP
        PERFORM organizations_validate_unit_lifecycle(
            unit_row.id, unit_row.organization_type_id, unit_row.parent_id, unit_row.status
        );
    END LOOP;
END;
$$;

CREATE FUNCTION organizations_enforce_unit_lifecycle()
RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Organization units cannot be deleted. Deactivate and archive them instead.'
            USING ERRCODE = '23514', CONSTRAINT = 'organization_lifecycle_no_delete';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Organization unit identifiers cannot be changed.'
            USING ERRCODE = '23514', CONSTRAINT = 'organization_lifecycle_identity';
    END IF;
    PERFORM organizations_validate_unit_lifecycle(NEW.id, NEW.organization_type_id, NEW.parent_id, NEW.status);
    RETURN NEW;
END;
$$;

CREATE TRIGGER organization_unit_lifecycle
    BEFORE INSERT OR UPDATE OR DELETE ON organizations_organizationunit
    FOR EACH ROW EXECUTE FUNCTION organizations_enforce_unit_lifecycle();
"""

REVERSE = """
DROP TRIGGER organization_unit_lifecycle ON organizations_organizationunit;
DROP FUNCTION organizations_enforce_unit_lifecycle();
DROP FUNCTION organizations_validate_unit_lifecycle(bigint, bigint, bigint, text);
DROP FUNCTION organizations_has_active_sites(bigint[]);
"""


class Migration(migrations.Migration):
    dependencies = [("organizations", "0004_hierarchy_integrity")]
    operations = [
        migrations.RemoveConstraint(model_name="organizationunit", name="organization_unit_valid_status"),
        migrations.AlterField(
            model_name="organizationunit", name="status",
            field=models.CharField(
                choices=[("ACTIVE", "Active"), ("INACTIVE", "Inactive"), ("ARCHIVED", "Archived")],
                default="ACTIVE", max_length=8, verbose_name="status",
            ),
        ),
        migrations.AddConstraint(
            model_name="organizationunit",
            constraint=models.CheckConstraint(
                condition=models.Q(status__in=["ACTIVE", "INACTIVE", "ARCHIVED"]),
                name="organization_unit_valid_status",
            ),
        ),
        migrations.AddConstraint(
            model_name="organizationunit",
            constraint=models.CheckConstraint(
                condition=models.Q(parent__isnull=False) | models.Q(status="ACTIVE"),
                name="organization_root_active",
            ),
        ),
        migrations.RunSQL(
            "LOCK TABLE organizations_organizationunit IN SHARE ROW EXCLUSIVE MODE;" + SITE_HOOK + RULES,
            reverse_sql=REVERSE,
        ),
    ]
