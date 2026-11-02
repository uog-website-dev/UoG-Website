"""Registry-independent taxonomy rules for api.0005.

Post, Category and Tag are multi-table children of ``cms_sitecontent``, so
``site`` and ``locale`` live on the shared parent row — a plain UNIQUE index
cannot span the two tables. The cross-table rules are therefore enforced by
one trigger, in the same style as ``apps.cms.page_sql``:

  - one active Category slug per (Site, locale),
  - one active Tag slug per (Site, locale),
  - one Post slug per (Site, locale).

Writers for one Site are serialized with an advisory lock so a racing
duplicate is detected instead of lost between snapshot and commit. The
model's ``clean()`` reports the same rules as field errors before the
database is reached.
"""

FORWARD = r"""
CREATE FUNCTION api_content_owner(uuid, OUT site_id bigint, OUT locale varchar)
RETURNS record LANGUAGE sql STABLE AS $$
    SELECT c.site_id, c.locale FROM cms_sitecontent c WHERE c.id = $1;
$$;

CREATE FUNCTION api_validate_taxonomy() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    own record;
    taken boolean;
    kind text := TG_ARGV[0];
BEGIN
    own := api_content_owner(NEW.sitecontent_ptr_id);
    IF own.site_id IS NULL THEN
        RAISE EXCEPTION 'The content row does not exist.'
            USING ERRCODE = '23503', CONSTRAINT = 'taxonomy_content_row';
    END IF;

    -- Serialize writes for one Site so duplicate detection cannot lose a
    -- race between this transaction's snapshot and its commit.
    PERFORM pg_advisory_xact_lock(hashtext('api_taxonomy:' || own.site_id::text));

    IF kind = 'category' THEN
        SELECT EXISTS (
            SELECT 1
            FROM api_category t
            JOIN cms_sitecontent c ON c.id = t.sitecontent_ptr_id
            WHERE t.sitecontent_ptr_id <> NEW.sitecontent_ptr_id
              AND t.is_active
              AND NEW.is_active
              AND t.slug = NEW.slug
              AND c.site_id = own.site_id
              AND c.locale = own.locale
        ) INTO taken;
        IF taken THEN
            RAISE EXCEPTION 'An active category with this slug already exists in this Site and language.'
                USING ERRCODE = '23514', CONSTRAINT = 'category_slug_site_uniq';
        END IF;
    ELSIF kind = 'tag' THEN
        SELECT EXISTS (
            SELECT 1
            FROM api_tag t
            JOIN cms_sitecontent c ON c.id = t.sitecontent_ptr_id
            WHERE t.sitecontent_ptr_id <> NEW.sitecontent_ptr_id
              AND t.is_active
              AND NEW.is_active
              AND t.slug = NEW.slug
              AND c.site_id = own.site_id
              AND c.locale = own.locale
        ) INTO taken;
        IF taken THEN
            RAISE EXCEPTION 'An active tag with this slug already exists in this Site and language.'
                USING ERRCODE = '23514', CONSTRAINT = 'tag_slug_site_uniq';
        END IF;
    ELSE
        SELECT EXISTS (
            SELECT 1
            FROM api_post p
            JOIN cms_sitecontent c ON c.id = p.sitecontent_ptr_id
            WHERE p.sitecontent_ptr_id <> NEW.sitecontent_ptr_id
              AND p.slug = NEW.slug
              AND c.site_id = own.site_id
              AND c.locale = own.locale
        ) INTO taken;
        IF taken THEN
            RAISE EXCEPTION 'A post with this slug already exists in this Site and language.'
                USING ERRCODE = '23514', CONSTRAINT = 'post_slug_site_uniq';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER category_taxonomy_rules
AFTER INSERT OR UPDATE OF slug, is_active ON api_category
FOR EACH ROW EXECUTE FUNCTION api_validate_taxonomy('category');

CREATE TRIGGER tag_taxonomy_rules
AFTER INSERT OR UPDATE OF slug, is_active ON api_tag
FOR EACH ROW EXECUTE FUNCTION api_validate_taxonomy('tag');

CREATE TRIGGER post_taxonomy_rules
AFTER INSERT OR UPDATE OF slug ON api_post
FOR EACH ROW EXECUTE FUNCTION api_validate_taxonomy('post');
"""

REVERSE = r"""
DROP TRIGGER IF EXISTS post_taxonomy_rules ON api_post;
DROP TRIGGER IF EXISTS tag_taxonomy_rules ON api_tag;
DROP TRIGGER IF EXISTS category_taxonomy_rules ON api_category;
DROP FUNCTION IF EXISTS api_validate_taxonomy();
DROP FUNCTION IF EXISTS api_content_owner(uuid);
"""
