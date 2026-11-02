"""Post-aware menu guards for cms.0012.

``api.Post`` is a multi-table child of ``cms_sitecontent`` (api.0005), so the
Post owner columns the menu guards read — ``site_id`` — live on the parent
row. This module freezes the three guard objects that must be rebuilt; the
rest of the menu safeguards installed by ``0009``/``0011`` are unchanged.
"""

FORWARD = r"""
DROP TRIGGER IF EXISTS menu_post_serialize ON api_post;
DROP TRIGGER IF EXISTS menu_post_serialize ON cms_sitecontent;
-- Module shutdown and target reassignment must serialize with menu edits.
-- Post ownership lives on the shared content row, so this watches that table.
CREATE TRIGGER menu_post_serialize BEFORE UPDATE ON cms_sitecontent
FOR EACH STATEMENT EXECUTE FUNCTION organizations_serialize_hierarchy();

DROP TRIGGER IF EXISTS menu_item_write ON cms_menuitem;
DROP FUNCTION IF EXISTS cms_menu_item_write();

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
            SELECT c.site_id INTO target_site FROM api_post p
              JOIN cms_sitecontent c ON c.id=p.sitecontent_ptr_id
             WHERE p.sitecontent_ptr_id=NEW.post_id;
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

DROP TRIGGER IF EXISTS menu_post_owner ON api_post;
DROP TRIGGER IF EXISTS menu_post_owner ON cms_sitecontent;
DROP FUNCTION IF EXISTS cms_menu_post_owner();
CREATE FUNCTION cms_menu_post_owner() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
    IF NEW.site_id IS DISTINCT FROM OLD.site_id AND EXISTS (
        SELECT 1 FROM cms_menuitem WHERE post_id=NEW.id AND (NEW.site_id IS NULL OR (NOT allow_cross_site AND site_id<>NEW.site_id))
    ) THEN
        RAISE EXCEPTION 'Moving this Post would invalidate a menu target.' USING ERRCODE='23514', CONSTRAINT='menu_post_owner';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER menu_post_owner BEFORE UPDATE OF site_id ON cms_sitecontent
FOR EACH ROW EXECUTE FUNCTION cms_menu_post_owner();
"""

REVERSE = r"""
DROP TRIGGER IF EXISTS menu_post_owner ON cms_sitecontent;
DROP FUNCTION IF EXISTS cms_menu_post_owner();
DROP TRIGGER IF EXISTS menu_item_write ON cms_menuitem;
DROP FUNCTION IF EXISTS cms_menu_item_write();
DROP TRIGGER IF EXISTS menu_post_serialize ON cms_sitecontent;
"""

LEGACY = r"""
CREATE TRIGGER menu_post_serialize BEFORE UPDATE ON api_post
FOR EACH STATEMENT EXECUTE FUNCTION organizations_serialize_hierarchy();

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
               OR NEW.target ~* '%(0[0-9a-f]|1[0-9a-f]|7f|5c|25)' OR NEW.target ~ '%([^0-9A-Fa-f]|[0-9A-Fa-f]([^0-9A-Fa-f]|$)|$)' THEN
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
"""
