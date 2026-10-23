"""Common sanitized writer and application-level append-only protection."""
from django.db import migrations

FORWARD = r"""
CREATE FUNCTION audit_sanitize(value jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb; entry record;
BEGIN
    IF jsonb_typeof(value) = 'object' THEN
        result := '{}'::jsonb;
        FOR entry IN SELECT key, val FROM jsonb_each(value) AS e(key, val) LOOP
            result := result || jsonb_build_object(entry.key,
                CASE WHEN entry.key ~* '(password|secret|token|authorization|cookie|credential|private.?key|session)'
                THEN to_jsonb('[REDACTED]'::text) ELSE audit_sanitize(entry.val) END);
        END LOOP;
        RETURN result;
    ELSIF jsonb_typeof(value) = 'array' THEN
        SELECT COALESCE(jsonb_agg(audit_sanitize(val) ORDER BY position), '[]'::jsonb)
        INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS e(val, position);
        RETURN result;
    END IF;
    RETURN value;
END;
$$;

CREATE FUNCTION audit_record_event(
    event_action text, event_entity_type text, event_entity_id text,
    event_before jsonb, event_after jsonb, event_changed_fields jsonb
) RETURNS bigint LANGUAGE plpgsql VOLATILE AS $$
DECLARE event_id bigint; kind text; identity text;
BEGIN
    IF event_action IS NULL OR event_action !~ '^[A-Z][A-Z0-9_]{0,99}$'
       OR event_entity_type IS NULL OR event_entity_type !~ '^[a-z][a-z0-9_.]{0,99}$'
       OR event_entity_id IS NULL OR btrim(event_entity_id) = ''
       OR jsonb_typeof(event_changed_fields) IS DISTINCT FROM 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(event_changed_fields) AS e(value) WHERE jsonb_typeof(value) <> 'string')
       OR (event_before IS NOT NULL AND jsonb_typeof(event_before) NOT IN ('object', 'null'))
       OR (event_after IS NOT NULL AND jsonb_typeof(event_after) NOT IN ('object', 'null'))
       OR octet_length(COALESCE(event_before::text, '') || COALESCE(event_after::text, '') || event_changed_fields::text) > 65536
    THEN
        RAISE EXCEPTION 'Invalid audit event contract.';
    END IF;
    kind := COALESCE(NULLIF(current_setting('audit.actor_kind', true), ''), 'SYSTEM');
    identity := COALESCE(NULLIF(current_setting('audit.actor_id', true), ''), 'system');
    INSERT INTO audit_auditevent (
        actor_kind, actor_id, action, entity_type, entity_id, timestamp,
        request_id, ip, before, after, changed_fields
    ) VALUES (
        kind, identity, event_action, event_entity_type, event_entity_id, clock_timestamp(),
        NULLIF(current_setting('audit.request_id', true), '')::uuid,
        NULLIF(current_setting('audit.ip', true), '')::inet,
        audit_sanitize(event_before), audit_sanitize(event_after), audit_sanitize(event_changed_fields)
    ) RETURNING id INTO event_id;
    RETURN event_id;
EXCEPTION WHEN OTHERS THEN
    -- Never permit a business mutation to commit without its audit event.
    -- The marker lets HTTP callers report an unavailable service, not SQL.
    RAISE EXCEPTION 'Audit persistence is unavailable.'
        USING ERRCODE = 'P0001', CONSTRAINT = 'audit_write_failed';
END;
$$;

CREATE FUNCTION audit_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Audit records are append-only.' USING ERRCODE = '23514', CONSTRAINT = 'audit_append_only';
END;
$$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_auditevent
FOR EACH ROW EXECUTE FUNCTION audit_reject_mutation();

CREATE FUNCTION audit_protect_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = TG_RELID)) THEN
        RAISE EXCEPTION 'Only the schema owner may perform audit maintenance.' USING ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER audit_protect_truncate BEFORE TRUNCATE ON audit_auditevent
FOR EACH STATEMENT EXECUTE FUNCTION audit_protect_truncate();
"""

REVERSE = """
DROP TRIGGER audit_protect_truncate ON audit_auditevent;
DROP FUNCTION audit_protect_truncate();
DROP TRIGGER audit_append_only ON audit_auditevent;
DROP FUNCTION audit_reject_mutation();
DROP FUNCTION audit_record_event(text, text, text, jsonb, jsonb, jsonb);
DROP FUNCTION audit_sanitize(jsonb);
"""


class Migration(migrations.Migration):
    dependencies = [("audit", "0001_initial")]
    operations = [migrations.RunSQL(FORWARD, reverse_sql=REVERSE)]
