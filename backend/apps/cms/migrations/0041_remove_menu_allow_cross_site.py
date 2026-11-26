"""Remove incomplete cross-site menu targets from the product contract.

Public delivery never resolved foreign Page/Post links and the admin API already
rejected new ones. Purge residual foreign rows, require same-Site targets in the
database guard, and drop the field from the Django model. The physical column is
left in place (always false after purge) so migrate-back tests that share a
transaction with pending menu-item trigger events are not blocked by ALTER TABLE.
"""

from django.db import migrations


FORWARD = r"""
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
    IF NEW.item_type IN ('news','category') THEN
        IF NEW.page_id IS NOT NULL OR NEW.post_id IS NOT NULL OR NEW.target<>''
           OR (NEW.item_type='news' AND NEW.category_id IS NOT NULL)
           OR (NEW.item_type='category' AND NOT EXISTS(SELECT 1 FROM api_category a JOIN cms_sitecontent c ON c.id=a.sitecontent_ptr_id WHERE a.sitecontent_ptr_id=NEW.category_id AND c.site_id=NEW.site_id)) THEN
            RAISE EXCEPTION 'News destinations must belong to the menu Site.' USING ERRCODE='23514', CONSTRAINT='menu_item_target_site';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.category_id IS NOT NULL THEN
        RAISE EXCEPTION 'Only category items can reference a category.' USING ERRCODE='23514', CONSTRAINT='menu_item_target';
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
        IF target_site IS NULL OR target_site <> NEW.site_id THEN
            RAISE EXCEPTION 'The target must belong to the same Site.' USING ERRCODE='23514', CONSTRAINT='menu_item_target_site';
        END IF;
    ELSE
        IF NEW.page_id IS NOT NULL OR NEW.post_id IS NOT NULL THEN
            RAISE EXCEPTION 'Only internal items can reference content.' USING ERRCODE='23514', CONSTRAINT='menu_item_target';
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

CREATE OR REPLACE FUNCTION cms_menu_post_owner() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
    IF NEW.site_id IS DISTINCT FROM OLD.site_id AND EXISTS (
        SELECT 1 FROM cms_menuitem WHERE post_id=NEW.id AND (NEW.site_id IS NULL OR site_id<>NEW.site_id)
    ) THEN
        RAISE EXCEPTION 'Moving this Post would invalidate a menu target.' USING ERRCODE='23514', CONSTRAINT='menu_post_owner';
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION cms_menu_audit_snapshot(value jsonb, item boolean) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_object_agg(key, val) FROM jsonb_each(value) entry(key,val)
    WHERE key=ANY(CASE WHEN item THEN
        ARRAY['id','menu_id','site_id','label','item_type','page_id','post_id','category_id','parent_id','sort_order','is_active']
        ELSE ARRAY['id','site_id','location','name','is_active','version','code','is_global'] END);
$$;
"""


REVERSE = r"""
CREATE OR REPLACE FUNCTION cms_menu_post_owner() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
    IF NEW.site_id IS DISTINCT FROM OLD.site_id AND EXISTS (
        SELECT 1 FROM cms_menuitem WHERE post_id=NEW.id AND (NEW.site_id IS NULL OR (NOT allow_cross_site AND site_id<>NEW.site_id))
    ) THEN
        RAISE EXCEPTION 'Moving this Post would invalidate a menu target.' USING ERRCODE='23514', CONSTRAINT='menu_post_owner';
    END IF;
    RETURN NEW;
END $$;
"""


def _purge_foreign_targets(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT i.id FROM cms_menuitem i
            JOIN cms_page p ON p.sitecontent_ptr_id = i.page_id
            JOIN cms_sitecontent c ON c.id = p.sitecontent_ptr_id
            WHERE c.site_id IS DISTINCT FROM i.site_id
            UNION
            SELECT i.id FROM cms_menuitem i
            JOIN api_post p ON p.sitecontent_ptr_id = i.post_id
            JOIN cms_sitecontent c ON c.id = p.sitecontent_ptr_id
            WHERE c.site_id IS DISTINCT FROM i.site_id
            UNION
            SELECT id FROM cms_menuitem WHERE allow_cross_site
            """
        )
        seeds = {row[0] for row in cursor.fetchall()}
        if seeds:
            cursor.execute(
                """
                WITH RECURSIVE tree AS (
                    SELECT id FROM cms_menuitem WHERE id = ANY(%s)
                    UNION ALL
                    SELECT c.id FROM cms_menuitem c JOIN tree t ON c.parent_id = t.id
                )
                SELECT id FROM tree
                """,
                [list(seeds)],
            )
            doomed = {row[0] for row in cursor.fetchall()}
        else:
            doomed = set()

        cursor.execute("ALTER TABLE cms_menuitem DISABLE TRIGGER USER")
        cursor.execute("ALTER TABLE cms_menu DISABLE TRIGGER USER")
        try:
            while doomed:
                cursor.execute(
                    """
                    SELECT id FROM cms_menuitem
                    WHERE id = ANY(%s)
                      AND NOT EXISTS (
                          SELECT 1 FROM cms_menuitem child
                          WHERE child.parent_id = cms_menuitem.id AND child.id = ANY(%s)
                      )
                    LIMIT 500
                    """,
                    [list(doomed), list(doomed)],
                )
                leaves = [row[0] for row in cursor.fetchall()]
                if not leaves:
                    cursor.execute("DELETE FROM cms_menuitem WHERE id = ANY(%s)", [list(doomed)])
                    break
                cursor.execute("DELETE FROM cms_menuitem WHERE id = ANY(%s)", [leaves])
                doomed -= set(leaves)
            cursor.execute("UPDATE cms_menuitem SET allow_cross_site = FALSE WHERE allow_cross_site")
            cursor.execute(
                """
                UPDATE cms_menu SET published_items = (
                    SELECT coalesce(jsonb_agg(elem - 'allow_cross_site'), '[]'::jsonb)
                    FROM jsonb_array_elements(coalesce(published_items, '[]'::jsonb)) elem
                )
                WHERE published_items IS NOT NULL
                """
            )
        finally:
            cursor.execute("ALTER TABLE cms_menu ENABLE TRIGGER USER")
            cursor.execute("ALTER TABLE cms_menuitem ENABLE TRIGGER USER")


class Migration(migrations.Migration):
    dependencies = [
        ("cms", "0040_published_inplace_snapshot"),
    ]

    operations = [
        migrations.RunPython(_purge_foreign_targets, migrations.RunPython.noop),
        migrations.RunSQL(FORWARD, REVERSE),
        migrations.RunSQL(
            "ALTER TABLE cms_menuitem ALTER COLUMN allow_cross_site SET DEFAULT FALSE;",
            migrations.RunSQL.noop,
        ),
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RemoveField(model_name="menuitem", name="allow_cross_site"),
            ],
            database_operations=[],
        ),
    ]
