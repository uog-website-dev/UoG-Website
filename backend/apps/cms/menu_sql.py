"""Frozen PostgreSQL safeguards for cms.0009; includes bulk/raw writers."""

FORWARD = r"""
-- Reuse the platform guard. Updating its revision also rejects stale
-- repeatable-read snapshots instead of validating a stale hierarchy.
CREATE TRIGGER menu_serialize BEFORE INSERT OR UPDATE OR DELETE ON cms_menu
FOR EACH STATEMENT EXECUTE FUNCTION organizations_serialize_hierarchy();
CREATE TRIGGER menu_item_serialize BEFORE INSERT OR UPDATE OR DELETE ON cms_menuitem
FOR EACH STATEMENT EXECUTE FUNCTION organizations_serialize_hierarchy();
-- Module shutdown and target reassignment must serialize with menu edits.
CREATE TRIGGER menu_module_serialize BEFORE INSERT OR UPDATE OR DELETE ON sites_module
FOR EACH STATEMENT EXECUTE FUNCTION organizations_serialize_hierarchy();
CREATE TRIGGER menu_site_module_serialize BEFORE INSERT OR UPDATE OR DELETE ON sites_sitemodule
FOR EACH STATEMENT EXECUTE FUNCTION organizations_serialize_hierarchy();
CREATE TRIGGER menu_post_serialize BEFORE UPDATE ON api_post
FOR EACH STATEMENT EXECUTE FUNCTION organizations_serialize_hierarchy();

CREATE FUNCTION cms_require_menus(owner bigint) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM sites_sitemodule sm JOIN sites_module m ON m.id = sm.module_id
        JOIN sites_module_implementation shipped ON shipped.code = m.code
        WHERE sm.site_id = owner AND m.code = 'MENUS' AND m.status = 'IMPLEMENTED'
          AND m.is_enabled AND sm.is_enabled
    ) THEN
        RAISE EXCEPTION 'The MENUS module is not enabled for this Site.'
            USING ERRCODE='23514', CONSTRAINT='menu_module_enabled';
    END IF;
END $$;

CREATE FUNCTION cms_menu_write() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM cms_require_menus(OLD.site_id);
        RETURN OLD;
    END IF;
    PERFORM cms_require_menus(NEW.site_id);
    IF btrim(NEW.name) = '' OR NEW.name <> btrim(NEW.name) THEN
        RAISE EXCEPTION 'A normalized menu name is required.' USING ERRCODE='23514', CONSTRAINT='menu_name';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.site_id IS DISTINCT FROM OLD.site_id) THEN
        RAISE EXCEPTION 'Menu identity and ownership are immutable.' USING ERRCODE='23514', CONSTRAINT='menu_identity';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER menu_write BEFORE INSERT OR UPDATE OR DELETE ON cms_menu
FOR EACH ROW EXECUTE FUNCTION cms_menu_write();

CREATE FUNCTION cms_menu_item_write() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE target_site bigint; host text; port text;
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM cms_require_menus(OLD.site_id);
        RETURN OLD;
    END IF;
    PERFORM cms_require_menus(NEW.site_id);
    IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.menu_id IS DISTINCT FROM OLD.menu_id OR NEW.site_id IS DISTINCT FROM OLD.site_id) THEN
        RAISE EXCEPTION 'Menu item identity and ownership are immutable.' USING ERRCODE='23514', CONSTRAINT='menu_item_identity';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cms_menu WHERE id=NEW.menu_id AND site_id=NEW.site_id) THEN
        RAISE EXCEPTION 'A menu item must belong to its menu Site.' USING ERRCODE='23514', CONSTRAINT='menu_item_owner';
    END IF;
    IF btrim(NEW.label) = '' OR NEW.label <> btrim(NEW.label) THEN
        RAISE EXCEPTION 'A normalized label is required.' USING ERRCODE='23514', CONSTRAINT='menu_item_label';
    END IF;
    IF NEW.item_type IN ('page', 'post') THEN
        IF NEW.target <> '' OR (NEW.item_type='page' AND (NEW.page_id IS NULL OR NEW.post_id IS NOT NULL))
           OR (NEW.item_type='post' AND (NEW.post_id IS NULL OR NEW.page_id IS NOT NULL)) THEN
            RAISE EXCEPTION 'Choose exactly one target of the selected type.' USING ERRCODE='23514', CONSTRAINT='menu_item_target';
        END IF;
        IF NEW.item_type='page' THEN
            SELECT c.site_id INTO target_site FROM cms_page p JOIN cms_sitecontent c ON c.id=p.sitecontent_ptr_id WHERE p.sitecontent_ptr_id=NEW.page_id;
        ELSE
            SELECT site_id INTO target_site FROM api_post WHERE id=NEW.post_id;
        END IF;
        IF target_site IS NULL OR (target_site <> NEW.site_id AND NOT NEW.allow_cross_site) THEN
            RAISE EXCEPTION 'The target must belong to the same Site unless cross-site linking is explicit.' USING ERRCODE='23514', CONSTRAINT='menu_item_target_site';
        END IF;
    ELSE
        IF NEW.page_id IS NOT NULL OR NEW.post_id IS NOT NULL OR NEW.allow_cross_site THEN
            RAISE EXCEPTION 'Only internal items can reference content or enable cross-site linking.' USING ERRCODE='23514', CONSTRAINT='menu_item_target';
        END IF;
        IF NEW.item_type='custom' AND NEW.target !~ '^/([a-z0-9][a-z0-9-]{0,63}(/[a-z0-9][a-z0-9-]{0,63})*)?$' THEN
            RAISE EXCEPTION 'Custom targets must be same-site paths.' USING ERRCODE='23514', CONSTRAINT='menu_custom_target';
        END IF;
        IF NEW.item_type='external' THEN
            IF NEW.target ~ '[[:cntrl:][:space:]]' OR position(chr(92) in NEW.target)>0
               OR NEW.target ~* '%(0[0-9a-f]|1[0-9a-f]|7f|5c|25)' OR NEW.target ~ '%([^0-9A-Fa-f]|[0-9A-Fa-f]([^0-9A-Fa-f]|$)|$)'
               OR NEW.target !~* '^https?://(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' THEN
                RAISE EXCEPTION 'External targets must be safe http(s) URLs without credentials.' USING ERRCODE='23514', CONSTRAINT='menu_external_url';
            END IF;
            host := split_part(substring(NEW.target from '(?i)^https?://([^/?#]+)'), '/', 1);
            port := substring(host from ':([0-9]+)$');
            IF port IS NOT NULL AND port::integer > 65535 THEN
                RAISE EXCEPTION 'Invalid external URL port.' USING ERRCODE='23514', CONSTRAINT='menu_external_url';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER menu_item_write BEFORE INSERT OR UPDATE OR DELETE ON cms_menuitem
FOR EACH ROW EXECUTE FUNCTION cms_menu_item_write();

-- AFTER sees the final statement state, including every row in a bulk move.
CREATE FUNCTION cms_menu_tree_check() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE chain_depth integer; subtree_depth integer; has_cycle boolean;
BEGIN
    IF NEW.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cms_menuitem WHERE id=NEW.parent_id AND menu_id=NEW.menu_id) THEN
        RAISE EXCEPTION 'The parent must belong to this menu.' USING ERRCODE='23514', CONSTRAINT='menu_parent_owner';
    END IF;
    WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, 1 depth, ARRAY[id] path, FALSE cycle FROM cms_menuitem WHERE id=NEW.id
        UNION ALL
        SELECT p.id, p.parent_id, a.depth+1, a.path || p.id, p.id=ANY(a.path)
        FROM cms_menuitem p JOIN ancestors a ON p.id=a.parent_id WHERE NOT a.cycle AND a.depth <= 4
    ) SELECT max(depth), bool_or(cycle) INTO chain_depth, has_cycle FROM ancestors;
    IF has_cycle THEN
        RAISE EXCEPTION 'Menu cycles are not allowed.' USING ERRCODE='23514', CONSTRAINT='menu_acyclic';
    END IF;
    WITH RECURSIVE descendants AS (
        SELECT id, 1 depth FROM cms_menuitem WHERE id=NEW.id
        UNION ALL
        SELECT c.id, d.depth+1 FROM cms_menuitem c JOIN descendants d ON c.parent_id=d.id WHERE d.depth <= 4
    ) SELECT max(depth) INTO subtree_depth FROM descendants;
    IF chain_depth + subtree_depth - 1 > 4 THEN
        RAISE EXCEPTION 'Menu items cannot be nested deeper than 4 levels.' USING ERRCODE='23514', CONSTRAINT='menu_max_depth';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER menu_tree AFTER INSERT OR UPDATE ON cms_menuitem
FOR EACH ROW EXECUTE FUNCTION cms_menu_tree_check();

CREATE FUNCTION cms_menu_post_owner() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
    IF NEW.site_id IS DISTINCT FROM OLD.site_id AND EXISTS (
        SELECT 1 FROM cms_menuitem WHERE post_id=NEW.id AND (NEW.site_id IS NULL OR (NOT allow_cross_site AND site_id<>NEW.site_id))
    ) THEN
        RAISE EXCEPTION 'Moving this Post would invalidate a menu target.' USING ERRCODE='23514', CONSTRAINT='menu_post_owner';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER menu_post_owner BEFORE UPDATE ON api_post
FOR EACH ROW EXECUTE FUNCTION cms_menu_post_owner();

-- Installing guards must not certify invalid rows written before this
-- migration. Do not turn on a disabled module merely to validate its data.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cms_menu WHERE name ~ '^\s*$' OR name <> btrim(name)) OR EXISTS (
        SELECT 1 FROM cms_menuitem i JOIN cms_menu m ON m.id=i.menu_id
        LEFT JOIN cms_menuitem parent ON parent.id=i.parent_id
        LEFT JOIN cms_sitecontent page ON page.id=i.page_id
        LEFT JOIN api_post post ON post.id=i.post_id
        WHERE i.site_id <> m.site_id OR i.label ~ '^\s*$' OR i.label <> btrim(i.label)
           OR (i.parent_id IS NOT NULL AND parent.menu_id <> i.menu_id)
           OR (i.item_type='page' AND (i.page_id IS NULL OR i.post_id IS NOT NULL OR i.target<>'' OR page.site_id IS NULL OR (NOT i.allow_cross_site AND page.site_id<>i.site_id)))
           OR (i.item_type='post' AND (i.post_id IS NULL OR i.page_id IS NOT NULL OR i.target<>'' OR post.site_id IS NULL OR (NOT i.allow_cross_site AND post.site_id<>i.site_id)))
           OR (i.item_type IN ('external','custom') AND (i.page_id IS NOT NULL OR i.post_id IS NOT NULL OR i.allow_cross_site))
           OR (i.item_type='custom' AND i.target !~ '^/([a-z0-9][a-z0-9-]{0,63}(/[a-z0-9][a-z0-9-]{0,63})*)?$')
           OR (i.item_type='external' AND (
               i.target ~ '[[:cntrl:][:space:]]' OR position(chr(92) in i.target)>0
               OR i.target ~* '%(0[0-9a-f]|1[0-9a-f]|7f|5c|25)' OR i.target ~ '%([^0-9A-Fa-f]|[0-9A-Fa-f]([^0-9A-Fa-f]|$)|$)'
               OR i.target !~* '^https?://(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:[0-9]{1,5})?([/?#][^[:space:]]*)?$'
               OR coalesce(substring(split_part(substring(i.target from '(?i)^https?://([^/?#]+)'), '/', 1) from ':([0-9]+)$')::numeric, 0)>65535
           ))
    ) THEN
        RAISE EXCEPTION 'Existing menus contain invalid ownership, labels or targets. Repair them before migrating.'
            USING ERRCODE='23514', CONSTRAINT='menu_existing_data';
    END IF;
    IF EXISTS (
        WITH RECURSIVE chain AS (
            SELECT id, parent_id, 1 depth, ARRAY[id] path, FALSE cycle FROM cms_menuitem
            UNION ALL
            SELECT p.id, p.parent_id, c.depth+1, c.path || p.id, p.id=ANY(c.path)
            FROM cms_menuitem p JOIN chain c ON p.id=c.parent_id WHERE NOT c.cycle AND c.depth<=4
        ) SELECT 1 FROM chain WHERE cycle OR depth>4
    ) THEN
        RAISE EXCEPTION 'Existing menus contain a cycle or excessive depth. Repair them before migrating.'
            USING ERRCODE='23514', CONSTRAINT='menu_existing_tree';
    END IF;
END $$;
"""

REVERSE = """
DROP TRIGGER menu_post_owner ON api_post;
DROP FUNCTION cms_menu_post_owner();
DROP TRIGGER menu_tree ON cms_menuitem;
DROP FUNCTION cms_menu_tree_check();
DROP TRIGGER menu_item_write ON cms_menuitem;
DROP FUNCTION cms_menu_item_write();
DROP TRIGGER menu_write ON cms_menu;
DROP FUNCTION cms_menu_write();
DROP FUNCTION cms_require_menus(bigint);
DROP TRIGGER menu_post_serialize ON api_post;
DROP TRIGGER menu_site_module_serialize ON sites_sitemodule;
DROP TRIGGER menu_module_serialize ON sites_module;
DROP TRIGGER menu_item_serialize ON cms_menuitem;
DROP TRIGGER menu_serialize ON cms_menu;
"""
