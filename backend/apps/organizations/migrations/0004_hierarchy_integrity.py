"""Serialize every hierarchy writer and reject cycles at the database boundary."""
from django.db import migrations, models


FORWARD = """
    LOCK TABLE organizations_organizationunit IN SHARE ROW EXCLUSIVE MODE;

    -- Refuse existing invalid data rather than silently reparenting units.
    DO $$
    BEGIN
        IF EXISTS (
            WITH RECURSIVE ancestry(source, ancestor) AS (
                SELECT id, parent_id FROM organizations_organizationunit WHERE parent_id IS NOT NULL
                UNION
                SELECT a.source, u.parent_id
                FROM ancestry a JOIN organizations_organizationunit u ON u.id = a.ancestor
                WHERE u.parent_id IS NOT NULL
            )
            SELECT 1 FROM ancestry WHERE source = ancestor
        ) THEN
            RAISE EXCEPTION 'Existing organization hierarchy contains a cycle.' USING ERRCODE = '23514';
        END IF;
    END;
    $$;

    -- This internal mutex is not a business model and has no admin/API.
    CREATE TABLE organizations_hierarchy_guard (
        singleton boolean PRIMARY KEY DEFAULT TRUE CHECK (singleton),
        revision bigint NOT NULL DEFAULT 0
    );
    INSERT INTO organizations_hierarchy_guard(singleton) VALUES (TRUE);

    CREATE FUNCTION organizations_lock_hierarchy()
    RETURNS void LANGUAGE plpgsql VOLATILE AS $$
    BEGIN
        UPDATE organizations_hierarchy_guard SET revision = revision + 1 WHERE singleton = TRUE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Organization hierarchy guard is missing.' USING ERRCODE = '23514';
        END IF;
    END;
    $$;

    CREATE FUNCTION organizations_serialize_hierarchy()
    RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
    BEGIN
        PERFORM organizations_lock_hierarchy();
        RETURN NULL;
    END;
    $$;

    CREATE TRIGGER organization_hierarchy_serialize
        BEFORE INSERT OR UPDATE OR DELETE ON organizations_organizationunit
        FOR EACH STATEMENT EXECUTE FUNCTION organizations_serialize_hierarchy();

    CREATE FUNCTION organizations_check_unit_cycle()
    RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
    BEGIN
        IF NEW.parent_id IS NULL THEN
            RETURN NEW;
        END IF;
        IF EXISTS (
            WITH RECURSIVE ancestry(id) AS (
                SELECT NEW.parent_id
                UNION
                SELECT u.parent_id FROM organizations_organizationunit u
                JOIN ancestry a ON u.id = a.id WHERE u.parent_id IS NOT NULL
            )
            SELECT 1 FROM ancestry WHERE id = NEW.id
        ) THEN
            RAISE EXCEPTION 'Organization hierarchy cannot contain a cycle.'
                USING ERRCODE = '23514', CONSTRAINT = 'organization_unit_acyclic';
        END IF;
        RETURN NEW;
    END;
    $$;

    CREATE TRIGGER organization_unit_acyclic
        AFTER INSERT OR UPDATE OF parent_id ON organizations_organizationunit
        FOR EACH ROW EXECUTE FUNCTION organizations_check_unit_cycle();
"""

REVERSE = """
    DROP TRIGGER organization_unit_acyclic ON organizations_organizationunit;
    DROP TRIGGER organization_hierarchy_serialize ON organizations_organizationunit;
    DROP FUNCTION organizations_check_unit_cycle();
    DROP FUNCTION organizations_serialize_hierarchy();
    DROP FUNCTION organizations_lock_hierarchy();
    DROP TABLE organizations_hierarchy_guard;
"""


class Migration(migrations.Migration):
    dependencies = [("organizations", "0003_organizationunit")]
    operations = [
        migrations.RunSQL(FORWARD, reverse_sql=REVERSE),
        migrations.AddConstraint(
            model_name="organizationunit",
            constraint=models.CheckConstraint(
                condition=~models.Q(parent=models.F("id")), name="organization_unit_not_self_parent",
            ),
        ),
    ]
