"""Emit domain events through the shared writer in the mutation transaction."""
from django.db import migrations

FORWARD = """
LOCK TABLE organizations_organizationunit IN SHARE ROW EXCLUSIVE MODE;

CREATE FUNCTION organizations_audit_snapshot(value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object(
        'id', value->'id', 'code', value->'code', 'name', value->'name',
        'short_name', value->'short_name', 'organization_type_id', value->'organization_type_id',
        'parent_id', value->'parent_id', 'status', value->'status',
        'created_at', value->'created_at', 'updated_at', value->'updated_at'
    );
$$;

CREATE FUNCTION organizations_audit_changes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous jsonb; current_value jsonb; changed jsonb; fields text[]; event_action text;
BEGIN
    current_value := to_jsonb(NEW);
    IF TG_OP = 'INSERT' THEN
        PERFORM audit_record_event('ORGANIZATION_CREATED', 'organizations.organizationunit', NEW.id::text,
            NULL, organizations_audit_snapshot(current_value),
            '["code", "name", "short_name", "organization_type_id", "parent_id", "description", "status", "metadata"]'::jsonb);
        RETURN NEW;
    END IF;
    previous := to_jsonb(OLD);
    SELECT array_agg(key ORDER BY key) INTO fields FROM jsonb_each(current_value) AS entry(key, value)
        WHERE key NOT IN ('created_at', 'updated_at') AND value IS DISTINCT FROM previous->key;
    IF fields IS NULL THEN RETURN NEW; END IF;
    changed := to_jsonb(fields);
    IF fields && ARRAY['code', 'name', 'short_name', 'organization_type_id', 'description', 'metadata'] THEN
        PERFORM audit_record_event('ORGANIZATION_UPDATED', 'organizations.organizationunit', NEW.id::text,
            organizations_audit_snapshot(previous), organizations_audit_snapshot(current_value), changed);
    END IF;
    IF 'parent_id' = ANY(fields) THEN
        PERFORM audit_record_event('ORGANIZATION_MOVED', 'organizations.organizationunit', NEW.id::text,
            organizations_audit_snapshot(previous), organizations_audit_snapshot(current_value), changed);
    END IF;
    IF 'status' = ANY(fields) THEN
        event_action := CASE NEW.status WHEN 'ACTIVE' THEN 'ORGANIZATION_ACTIVATED'
            WHEN 'INACTIVE' THEN 'ORGANIZATION_DEACTIVATED' WHEN 'ARCHIVED' THEN 'ORGANIZATION_ARCHIVED' END;
        PERFORM audit_record_event(event_action, 'organizations.organizationunit', NEW.id::text,
            organizations_audit_snapshot(previous), organizations_audit_snapshot(current_value), changed);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER organization_unit_audit AFTER INSERT OR UPDATE ON organizations_organizationunit
FOR EACH ROW EXECUTE FUNCTION organizations_audit_changes();
"""

REVERSE = """
DROP TRIGGER organization_unit_audit ON organizations_organizationunit;
DROP FUNCTION organizations_audit_changes();
DROP FUNCTION organizations_audit_snapshot(jsonb);
"""


class Migration(migrations.Migration):
    dependencies = [("organizations", "0005_lifecycle_rules"), ("audit", "0002_common_writer")]
    operations = [migrations.RunSQL(FORWARD, reverse_sql=REVERSE)]
