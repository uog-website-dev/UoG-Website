"""Database backstops for the CMS state machine and published content locks."""

FORWARD = r"""
CREATE FUNCTION cms_validate_workflow_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'DRAFT' THEN
            RAISE EXCEPTION 'New content must start as a draft.'
                USING ERRCODE = '23514', CONSTRAINT = 'content_workflow_initial_state';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF current_setting('cms.workflow_transition', true) IS DISTINCT FROM 'on' THEN
            RAISE EXCEPTION 'Use the content workflow service to change status.'
                USING ERRCODE = '23514', CONSTRAINT = 'content_workflow_service_only';
        END IF;

        IF NOT (
            (OLD.status = 'DRAFT' AND NEW.status = 'IN_REVIEW')
            OR (OLD.status = 'IN_REVIEW' AND NEW.status IN ('APPROVED', 'DRAFT'))
            OR (OLD.status = 'APPROVED' AND NEW.status IN ('PUBLISHED', 'ARCHIVED'))
            OR (OLD.status = 'PUBLISHED' AND NEW.status IN ('UNPUBLISHED', 'ARCHIVED'))
            OR (OLD.status = 'UNPUBLISHED' AND NEW.status IN ('DRAFT', 'ARCHIVED'))
        ) THEN
            RAISE EXCEPTION 'Invalid content workflow transition.'
                USING ERRCODE = '23514', CONSTRAINT = 'content_workflow_transition';
        END IF;
    END IF;

    IF OLD.status IN ('IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED')
       AND (
           NEW.site_id IS DISTINCT FROM OLD.site_id
           OR NEW.locale IS DISTINCT FROM OLD.locale
           OR NEW.metadata IS DISTINCT FROM OLD.metadata
           OR NEW.blocks IS DISTINCT FROM OLD.blocks
           OR NEW.blocks_version IS DISTINCT FROM OLD.blocks_version
       ) THEN
        RAISE EXCEPTION 'Content is locked in its current workflow state.'
            USING ERRCODE = '23514', CONSTRAINT = 'content_workflow_content_locked';
    END IF;

    IF OLD.published_at IS NOT NULL
       AND NEW.published_at IS DISTINCT FROM OLD.published_at THEN
        RAISE EXCEPTION 'The first publication timestamp is immutable.'
            USING ERRCODE = '23514', CONSTRAINT = 'content_published_at_immutable';
    END IF;
    IF current_setting('cms.workflow_transition', true) IS DISTINCT FROM 'on'
       AND (
           NEW.submitted_by_id IS DISTINCT FROM OLD.submitted_by_id
           OR NEW.reviewed_by_id IS DISTINCT FROM OLD.reviewed_by_id
           OR NEW.review_comment IS DISTINCT FROM OLD.review_comment
       ) THEN
        RAISE EXCEPTION 'Workflow attribution and comments are service-managed.'
            USING ERRCODE = '23514', CONSTRAINT = 'content_workflow_metadata_service_only';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER content_workflow_rules
BEFORE INSERT OR UPDATE ON cms_sitecontent
FOR EACH ROW EXECUTE FUNCTION cms_validate_workflow_write();

CREATE FUNCTION cms_protect_page_workflow_content() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE content_status text;
BEGIN
    SELECT status INTO content_status
    FROM cms_sitecontent
    WHERE id = NEW.sitecontent_ptr_id;

    IF content_status IN ('IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED')
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
        RAISE EXCEPTION 'Page content is locked in its current workflow state.'
            USING ERRCODE = '23514', CONSTRAINT = 'page_workflow_content_locked';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER page_workflow_content_rules
BEFORE UPDATE ON cms_page
FOR EACH ROW EXECUTE FUNCTION cms_protect_page_workflow_content();

CREATE FUNCTION cms_audit_workflow_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE audit_action text;
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;
    audit_action := CASE NEW.status
        WHEN 'IN_REVIEW' THEN 'CONTENT_SUBMITTED'
        WHEN 'APPROVED' THEN 'CONTENT_APPROVED'
        WHEN 'PUBLISHED' THEN 'CONTENT_PUBLISHED'
        WHEN 'UNPUBLISHED' THEN 'CONTENT_UNPUBLISHED'
        WHEN 'ARCHIVED' THEN 'CONTENT_ARCHIVED'
        WHEN 'DRAFT' THEN
            CASE OLD.status
                WHEN 'IN_REVIEW' THEN 'CONTENT_REJECTED'
                ELSE 'CONTENT_RESTORED'
            END
        ELSE NULL
    END;
    PERFORM audit_record_event(
        audit_action,
        'cms.sitecontent',
        NEW.id::text,
        jsonb_build_object('site_id', OLD.site_id, 'status', OLD.status),
        jsonb_build_object(
            'site_id', NEW.site_id,
            'status', NEW.status,
            'review_comment', NEW.review_comment
        ),
        jsonb_build_array('status')
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER content_workflow_audit
AFTER UPDATE OF status ON cms_sitecontent
FOR EACH ROW EXECUTE FUNCTION cms_audit_workflow_transition();

CREATE FUNCTION cms_validate_workflow_history_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE current_status text;
BEGIN
    IF current_setting('cms.workflow_transition', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'Workflow history is written by the workflow service.'
            USING ERRCODE = '23514', CONSTRAINT = 'cms_workflow_history_service_only';
    END IF;
    SELECT status INTO current_status
    FROM cms_sitecontent
    WHERE id = NEW.content_id;
    IF current_status IS DISTINCT FROM NEW.to_status
       OR NOT (
           (NEW.from_status = 'DRAFT' AND NEW.to_status = 'IN_REVIEW')
           OR (NEW.from_status = 'IN_REVIEW' AND NEW.to_status IN ('APPROVED', 'DRAFT'))
           OR (NEW.from_status = 'APPROVED' AND NEW.to_status IN ('PUBLISHED', 'ARCHIVED'))
           OR (NEW.from_status = 'PUBLISHED' AND NEW.to_status IN ('UNPUBLISHED', 'ARCHIVED'))
           OR (NEW.from_status = 'UNPUBLISHED' AND NEW.to_status IN ('DRAFT', 'ARCHIVED'))
       ) THEN
        RAISE EXCEPTION 'Workflow history does not match a valid content transition.'
            USING ERRCODE = '23514', CONSTRAINT = 'cms_workflow_history_transition';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER cms_workflow_transition_validate_insert
BEFORE INSERT ON cms_contentworkflowtransition
FOR EACH ROW EXECUTE FUNCTION cms_validate_workflow_history_insert();

CREATE FUNCTION cms_validate_snapshot_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE content_site_id bigint; content_status text; next_version integer;
BEGIN
    IF current_setting('cms.workflow_transition', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'Publication snapshots are written by the workflow service.'
            USING ERRCODE = '23514', CONSTRAINT = 'cms_snapshot_service_only';
    END IF;
    SELECT site_id, status INTO content_site_id, content_status
    FROM cms_sitecontent
    WHERE id = NEW.content_id;
    SELECT COALESCE(MAX(version), 0) + 1 INTO next_version
    FROM cms_publishedcontentsnapshot
    WHERE content_id = NEW.content_id;
    IF content_status IS DISTINCT FROM 'PUBLISHED'
       OR NEW.payload->>'site_id' IS DISTINCT FROM content_site_id::text
       OR NEW.payload->>'content_id' IS DISTINCT FROM NEW.content_id::text
       OR NEW.version <> next_version THEN
        RAISE EXCEPTION 'Snapshot must match the current published SiteContent version.'
            USING ERRCODE = '23514', CONSTRAINT = 'cms_snapshot_published_content';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER cms_publication_snapshot_validate_insert
BEFORE INSERT ON cms_publishedcontentsnapshot
FOR EACH ROW EXECUTE FUNCTION cms_validate_snapshot_insert();

CREATE FUNCTION cms_reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'CMS workflow history and publication snapshots are immutable.'
        USING ERRCODE = '23514', CONSTRAINT = 'cms_history_append_only';
END;
$$;

CREATE TRIGGER cms_workflow_transition_append_only
BEFORE UPDATE OR DELETE ON cms_contentworkflowtransition
FOR EACH ROW EXECUTE FUNCTION cms_reject_history_mutation();
CREATE TRIGGER cms_publication_snapshot_append_only
BEFORE UPDATE OR DELETE ON cms_publishedcontentsnapshot
FOR EACH ROW EXECUTE FUNCTION cms_reject_history_mutation();

"""

REVERSE = r"""
DROP TRIGGER cms_publication_snapshot_append_only ON cms_publishedcontentsnapshot;
DROP TRIGGER cms_publication_snapshot_validate_insert ON cms_publishedcontentsnapshot;
DROP FUNCTION cms_validate_snapshot_insert();
DROP TRIGGER cms_workflow_transition_append_only ON cms_contentworkflowtransition;
DROP TRIGGER cms_workflow_transition_validate_insert ON cms_contentworkflowtransition;
DROP FUNCTION cms_validate_workflow_history_insert();
DROP FUNCTION cms_reject_history_mutation();
DROP TRIGGER content_workflow_audit ON cms_sitecontent;
DROP FUNCTION cms_audit_workflow_transition();
DROP TRIGGER page_workflow_content_rules ON cms_page;
DROP FUNCTION cms_protect_page_workflow_content();
DROP TRIGGER content_workflow_rules ON cms_sitecontent;
DROP FUNCTION cms_validate_workflow_write();
"""
