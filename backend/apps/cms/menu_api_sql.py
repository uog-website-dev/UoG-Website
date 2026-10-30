"""Frozen versioning and durable shared audit contract for cms.0010."""

FORWARD = r"""
CREATE FUNCTION cms_menu_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='INSERT' THEN
        NEW.version := 1;
    ELSE
        IF NEW.version IS DISTINCT FROM OLD.version THEN
            RAISE EXCEPTION 'The menu version is server managed.' USING ERRCODE='23514', CONSTRAINT='menu_version_managed';
        END IF;
        NEW.version := OLD.version + 1;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER menu_version BEFORE INSERT OR UPDATE ON cms_menu
FOR EACH ROW EXECUTE FUNCTION cms_menu_version();

CREATE FUNCTION cms_menu_audit_snapshot(value jsonb, item boolean) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_object_agg(key, val) FROM jsonb_each(value) entry(key,val)
    WHERE key=ANY(CASE WHEN item THEN
        ARRAY['id','menu_id','site_id','label','item_type','page_id','post_id','parent_id','sort_order','is_active','allow_cross_site']
        ELSE ARRAY['id','site_id','location','name','is_active','version'] END);
$$;

CREATE FUNCTION cms_menu_audit() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE before_value jsonb; after_value jsonb; fields jsonb; event text; target_changed boolean := FALSE;
        is_item boolean := TG_TABLE_NAME='cms_menuitem'; record_id uuid; owning_menu uuid;
BEGIN
    IF TG_OP<>'INSERT' THEN before_value := cms_menu_audit_snapshot(to_jsonb(OLD), is_item); END IF;
    IF TG_OP<>'DELETE' THEN after_value := cms_menu_audit_snapshot(to_jsonb(NEW), is_item); END IF;
    IF TG_OP='UPDATE' THEN
        IF is_item THEN target_changed := OLD.target IS DISTINCT FROM NEW.target; END IF;
        IF (before_value-'version') IS NOT DISTINCT FROM (after_value-'version') AND NOT target_changed THEN RETURN NULL; END IF;
    END IF;
    SELECT coalesce(jsonb_agg(key ORDER BY key), '[]'::jsonb) INTO fields
    FROM jsonb_each(coalesce(before_value,'{}') || coalesce(after_value,'{}'))
    WHERE before_value->key IS DISTINCT FROM after_value->key;
    record_id := coalesce(after_value->>'id', before_value->>'id')::uuid;
    IF is_item THEN
        owning_menu := coalesce(after_value->>'menu_id', before_value->>'menu_id')::uuid;
        -- This also invalidates tokens for raw/bulk item writes. The menu audit
        -- ignores this version-only update, avoiding a second noisy event.
        UPDATE cms_menu SET updated_at=clock_timestamp() WHERE id=owning_menu;
        event := CASE TG_OP WHEN 'INSERT' THEN 'MENU_ITEM_CREATED' WHEN 'DELETE' THEN 'MENU_ITEM_DELETED'
            ELSE CASE WHEN OLD.parent_id IS DISTINCT FROM NEW.parent_id THEN 'MENU_ITEM_MOVED'
                      WHEN OLD.sort_order IS DISTINCT FROM NEW.sort_order THEN 'MENU_ITEM_REORDERED'
                      ELSE 'MENU_ITEM_UPDATED' END END;
        IF target_changed THEN
            fields := fields || '["target"]'::jsonb;
            -- Never log URL query strings/fragments or raw request bodies.
            after_value := after_value || '{"target_changed":true}'::jsonb;
        END IF;
    ELSE
        event := CASE TG_OP WHEN 'INSERT' THEN 'MENU_CREATED' WHEN 'DELETE' THEN 'MENU_DELETED'
            ELSE CASE WHEN OLD.is_active IS DISTINCT FROM NEW.is_active
                      THEN CASE WHEN NEW.is_active THEN 'MENU_ACTIVATED' ELSE 'MENU_DEACTIVATED' END
                      ELSE 'MENU_UPDATED' END END;
    END IF;
    PERFORM audit_record_event(event, CASE WHEN is_item THEN 'cms.menu_item' ELSE 'cms.menu' END,
        record_id::text, before_value, after_value, fields);
    RETURN NULL;
END $$;
CREATE TRIGGER menu_audit AFTER INSERT OR UPDATE OR DELETE ON cms_menu
FOR EACH ROW EXECUTE FUNCTION cms_menu_audit();
CREATE TRIGGER menu_item_audit AFTER INSERT OR UPDATE OR DELETE ON cms_menuitem
FOR EACH ROW EXECUTE FUNCTION cms_menu_audit();
"""

REVERSE = """
DROP TRIGGER menu_item_audit ON cms_menuitem;
DROP TRIGGER menu_audit ON cms_menu;
DROP FUNCTION cms_menu_audit();
DROP FUNCTION cms_menu_audit_snapshot(jsonb, boolean);
DROP TRIGGER menu_version ON cms_menu;
DROP FUNCTION cms_menu_version();
"""
