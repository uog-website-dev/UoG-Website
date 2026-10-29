"""Registry-independent page rules for cms.0002.

The Page table is a multi-table child of SiteContent, so `site` and `locale`
live on the parent row — a plain UNIQUE index cannot span the two tables.
The cross-table rules are therefore enforced by one trigger, in the same
style as sites.module_sql and organizations.0004:

  - one route per (Site, locale): no duplicate full paths,
  - one homepage per Site, even under concurrent writers,
  - parents share the Site and locale, never the page itself,
  - the hierarchy cannot contain a cycle (recursive walk, bounded).

Writers for one Site are serialized with an advisory lock so a racing
duplicate is detected instead of lost between snapshot and commit.
"""

FORWARD = r"""
CREATE FUNCTION cms_page_site_of(uuid, OUT site_id bigint, OUT locale varchar)
RETURNS record LANGUAGE sql STABLE AS $$
    SELECT c.site_id, c.locale FROM cms_sitecontent c WHERE c.id = $1;
$$;

CREATE FUNCTION cms_validate_page() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    own record;
    parent_site bigint;
    parent_locale varchar;
    route_taken boolean;
    homepage_site bigint;
    problem text;
BEGIN
    own := cms_page_site_of(NEW.sitecontent_ptr_id);
    IF own.site_id IS NULL THEN
        RAISE EXCEPTION 'The page content row does not exist.'
            USING ERRCODE = '23503', CONSTRAINT = 'page_content_row';
    END IF;

    -- Serialize page writes per Site so duplicate detection cannot lose a
    -- race between this transaction's snapshot and its commit.
    PERFORM pg_advisory_xact_lock(hashtext('cms_page:' || own.site_id::text));

    IF NEW.parent_id IS NOT NULL THEN
        IF NEW.parent_id = NEW.sitecontent_ptr_id THEN
            RAISE EXCEPTION 'A page cannot be its own parent.'
                USING ERRCODE = '23514', CONSTRAINT = 'page_parent_not_self';
        END IF;
        SELECT p.site_id, p.locale INTO parent_site, parent_locale
        FROM cms_page c
        JOIN cms_sitecontent p ON p.id = c.sitecontent_ptr_id
        WHERE c.sitecontent_ptr_id = NEW.parent_id;
        IF parent_site IS NULL THEN
            RAISE EXCEPTION 'The parent page does not exist.'
                USING ERRCODE = '23503', CONSTRAINT = 'page_parent_valid';
        END IF;
        IF parent_site <> own.site_id THEN
            RAISE EXCEPTION 'The parent must belong to the same Site.'
                USING ERRCODE = '23514', CONSTRAINT = 'page_parent_site';
        END IF;
        IF parent_locale IS DISTINCT FROM own.locale THEN
            RAISE EXCEPTION 'The parent must be in the same language as the page.'
                USING ERRCODE = '23514', CONSTRAINT = 'page_parent_locale';
        END IF;
        -- Bounded recursive walk: a cycle never terminates, so the depth
        -- guard both stops the walk and reports corrupt hierarchies.
        SELECT min(CASE WHEN id = NEW.sitecontent_ptr_id THEN 'cycle'
                        WHEN depth >= 64 THEN 'depth' END)
        INTO problem
        FROM (
            WITH RECURSIVE ancestry(id, depth) AS (
                SELECT NEW.parent_id, 1
                UNION ALL
                SELECT c.parent_id, a.depth + 1
                FROM ancestry a
                JOIN cms_page c ON c.sitecontent_ptr_id = a.id
                WHERE c.parent_id IS NOT NULL AND a.depth < 64
            )
            SELECT id, depth FROM ancestry
        ) walk;
        IF problem = 'cycle' THEN
            RAISE EXCEPTION 'A page cannot be its own ancestor.'
                USING ERRCODE = '23514', CONSTRAINT = 'page_acyclic';
        ELSIF problem = 'depth' THEN
            RAISE EXCEPTION 'Page hierarchy is too deep or contains a cycle.'
                USING ERRCODE = '23514', CONSTRAINT = 'page_depth';
        END IF;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM cms_page c
        JOIN cms_sitecontent p ON p.id = c.sitecontent_ptr_id
        WHERE c.sitecontent_ptr_id <> NEW.sitecontent_ptr_id
          AND c.path = NEW.path
          AND p.site_id = own.site_id
          AND p.locale = own.locale
    ) INTO route_taken;
    IF route_taken THEN
        RAISE EXCEPTION 'A page with this route already exists in this Site and language.'
            USING ERRCODE = '23514', CONSTRAINT = 'page_route_uniq';
    END IF;

    IF NEW.is_homepage THEN
        SELECT p.site_id INTO homepage_site
        FROM cms_page c
        JOIN cms_sitecontent p ON p.id = c.sitecontent_ptr_id
        WHERE c.is_homepage
          AND c.sitecontent_ptr_id <> NEW.sitecontent_ptr_id
          AND p.site_id = own.site_id
        LIMIT 1;
        IF homepage_site IS NOT NULL THEN
            RAISE EXCEPTION 'This Site already has a homepage.'
                USING ERRCODE = '23514', CONSTRAINT = 'page_homepage_uniq';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER page_route_rules
BEFORE INSERT OR UPDATE ON cms_page
FOR EACH ROW EXECUTE FUNCTION cms_validate_page();
"""

REVERSE = r"""
DROP TRIGGER page_route_rules ON cms_page;
DROP FUNCTION cms_validate_page();
DROP FUNCTION cms_page_site_of(uuid);
"""
