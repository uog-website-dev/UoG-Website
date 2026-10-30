"""Database backstops for immutable, complete CMS revision history."""

FORWARD = r"""
CREATE FUNCTION cms_require_revision_context() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF current_setting('cms.content_revision_write', true) IS DISTINCT FROM 'on' THEN
            RAISE EXCEPTION 'Content changes must create a revision.'
                USING ERRCODE = '23514', CONSTRAINT = 'cms_content_revision_required';
        END IF;
        IF NEW.revision_number <> 1 THEN
            RAISE EXCEPTION 'New content must begin at revision 1.'
                USING ERRCODE = '23514', CONSTRAINT = 'cms_content_revision_initial';
        END IF;
        RETURN NEW;
    END IF;
    IF current_setting('cms.content_revision_write', true) IS DISTINCT FROM 'on'
       AND (
           NEW.revision_number IS DISTINCT FROM OLD.revision_number
           OR NEW.site_id IS DISTINCT FROM OLD.site_id
           OR NEW.status IS DISTINCT FROM OLD.status
           OR NEW.locale IS DISTINCT FROM OLD.locale
           OR NEW.published_at IS DISTINCT FROM OLD.published_at
           OR NEW.review_comment IS DISTINCT FROM OLD.review_comment
           OR NEW.metadata IS DISTINCT FROM OLD.metadata
           OR NEW.blocks IS DISTINCT FROM OLD.blocks
           OR NEW.blocks_version IS DISTINCT FROM OLD.blocks_version
       ) THEN
        RAISE EXCEPTION 'Content changes must create a revision.'
            USING ERRCODE = '23514', CONSTRAINT = 'cms_content_revision_required';
    END IF;
    IF (
        NEW.site_id IS DISTINCT FROM OLD.site_id
        OR NEW.status IS DISTINCT FROM OLD.status
        OR NEW.locale IS DISTINCT FROM OLD.locale
        OR NEW.published_at IS DISTINCT FROM OLD.published_at
        OR NEW.review_comment IS DISTINCT FROM OLD.review_comment
        OR NEW.metadata IS DISTINCT FROM OLD.metadata
        OR NEW.blocks IS DISTINCT FROM OLD.blocks
        OR NEW.blocks_version IS DISTINCT FROM OLD.blocks_version
    ) AND NEW.revision_number <> OLD.revision_number + 1 THEN
        RAISE EXCEPTION 'A meaningful content change must advance exactly one revision.'
            USING ERRCODE = '23514', CONSTRAINT = 'cms_content_revision_sequence';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER cms_content_revision_context
BEFORE INSERT OR UPDATE ON cms_sitecontent
FOR EACH ROW EXECUTE FUNCTION cms_require_revision_context();

CREATE FUNCTION cms_validate_revision_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE current_version integer; current_status text; current_site_id bigint;
BEGIN
    IF current_setting('cms.content_revision_write', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'Content revisions are written by the content save service.'
            USING ERRCODE = '23514', CONSTRAINT = 'cms_content_revision_service_only';
    END IF;
    SELECT revision_number, status, site_id
      INTO current_version, current_status, current_site_id
      FROM cms_sitecontent
     WHERE id = NEW.content_id;
    IF current_version IS DISTINCT FROM NEW.revision_number
       OR current_status IS DISTINCT FROM NEW.status
       OR current_site_id IS DISTINCT FROM NEW.site_id
       OR NEW.snapshot->>'content_id' IS DISTINCT FROM NEW.content_id::text
       OR NEW.snapshot->>'site_id' IS DISTINCT FROM NEW.site_id::text
       OR NEW.snapshot->>'status' IS DISTINCT FROM NEW.status
       OR octet_length(convert_to(NEW.snapshot::text, 'UTF8')) > 1048576 THEN
        RAISE EXCEPTION 'Revision snapshot does not match the current bounded content.'
            USING ERRCODE = '23514', CONSTRAINT = 'cms_content_revision_snapshot_valid';
    END IF;
    IF NEW.restored_from_revision IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM cms_contentrevision source
         WHERE source.content_id = NEW.content_id
           AND source.revision_number = NEW.restored_from_revision
           AND source.revision_number < NEW.revision_number
    ) THEN
        RAISE EXCEPTION 'A restored revision must reference older history of this content.'
            USING ERRCODE = '23514', CONSTRAINT = 'cms_content_revision_restore_source';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER cms_content_revision_validate_insert
BEFORE INSERT ON cms_contentrevision
FOR EACH ROW EXECUTE FUNCTION cms_validate_revision_insert();

CREATE FUNCTION cms_require_revision_before_page_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF current_setting('cms.content_revision_write', true) IS DISTINCT FROM 'on'
       AND (
           NEW.parent_id IS DISTINCT FROM OLD.parent_id
           OR NEW.title IS DISTINCT FROM OLD.title
           OR NEW.slug IS DISTINCT FROM OLD.slug
           OR NEW.path IS DISTINCT FROM OLD.path
           OR NEW.layout IS DISTINCT FROM OLD.layout
           OR NEW.seo IS DISTINCT FROM OLD.seo
           OR NEW.visibility IS DISTINCT FROM OLD.visibility
           OR NEW.position IS DISTINCT FROM OLD.position
           OR NEW.is_homepage IS DISTINCT FROM OLD.is_homepage
       ) THEN
        RAISE EXCEPTION 'Page changes must create a revision.'
            USING ERRCODE = '23514', CONSTRAINT = 'cms_page_revision_required';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER cms_page_revision_context
BEFORE UPDATE ON cms_page
FOR EACH ROW EXECUTE FUNCTION cms_require_revision_before_page_update();

CREATE FUNCTION cms_content_revision_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE'
       AND current_setting('cms.revision_retention', true) IS NOT DISTINCT FROM 'on' THEN
        RETURN OLD;
    END IF;
    IF TG_OP = 'DELETE'
       AND current_setting('cms.content_delete', true) IS NOT DISTINCT FROM 'on' THEN
        RETURN OLD;
    END IF;
    IF TG_OP = 'DELETE' AND NOT EXISTS (
        SELECT 1 FROM cms_sitecontent WHERE id = OLD.content_id
    ) THEN
        RETURN OLD;
    END IF;
    IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Content revisions are immutable.'
        USING ERRCODE = '23514', CONSTRAINT = 'cms_content_revision_append_only';
END;
$$;

CREATE TRIGGER cms_content_revision_append_only
BEFORE UPDATE OR DELETE ON cms_contentrevision
FOR EACH ROW EXECUTE FUNCTION cms_content_revision_append_only();

CREATE FUNCTION cms_protect_published_content_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM cms_contentrevision
         WHERE content_id = OLD.id
           AND status = 'PUBLISHED'
    ) OR EXISTS (
        SELECT 1
          FROM cms_publishedcontentsnapshot
         WHERE content_id = OLD.id
    ) THEN
        RAISE EXCEPTION 'Published content and its revision history cannot be deleted.'
            USING ERRCODE = '23514', CONSTRAINT = 'cms_published_content_delete_protected';
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER cms_published_content_delete_protected
BEFORE DELETE ON cms_sitecontent
FOR EACH ROW EXECUTE FUNCTION cms_protect_published_content_delete();

CREATE FUNCTION cms_content_revision_must_exist() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE current_version integer;
BEGIN
    SELECT revision_number INTO current_version
      FROM cms_sitecontent
     WHERE id = NEW.id;
    IF NEW.revision_number IS DISTINCT FROM current_version THEN
        RETURN NULL;
    END IF;
    IF NOT EXISTS (
        SELECT 1
          FROM cms_contentrevision
         WHERE content_id = NEW.id
           AND revision_number = current_version
    ) THEN
        RAISE EXCEPTION 'Every content version must have an immutable revision.'
            USING ERRCODE = '23514', CONSTRAINT = 'cms_content_revision_missing';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER cms_content_revision_must_exist
AFTER INSERT OR UPDATE ON cms_sitecontent
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cms_content_revision_must_exist();
"""

REVERSE = r"""
DROP TRIGGER cms_content_revision_must_exist ON cms_sitecontent;
DROP FUNCTION cms_content_revision_must_exist();
DROP TRIGGER cms_content_revision_append_only ON cms_contentrevision;
DROP FUNCTION cms_content_revision_append_only();
DROP TRIGGER cms_published_content_delete_protected ON cms_sitecontent;
DROP FUNCTION cms_protect_published_content_delete();
DROP TRIGGER cms_page_revision_context ON cms_page;
DROP FUNCTION cms_require_revision_before_page_update();
DROP TRIGGER cms_content_revision_validate_insert ON cms_contentrevision;
DROP FUNCTION cms_validate_revision_insert();
DROP TRIGGER cms_content_revision_context ON cms_sitecontent;
DROP FUNCTION cms_require_revision_context();
"""
