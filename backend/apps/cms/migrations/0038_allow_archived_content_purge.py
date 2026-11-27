"""Allow controlled purge of archived/unpublished content history.

Permanent delete of ARCHIVED/UNPUBLISHED SiteContent must clear append-only
workflow rows and publication snapshots under cms.content_delete, and the
published-content delete guard must allow those statuses when that flag is on.
"""

from django.db import migrations


FORWARD = r"""
CREATE OR REPLACE FUNCTION cms_reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE'
       AND current_setting('cms.content_delete', true) IS NOT DISTINCT FROM 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'CMS workflow history and publication snapshots are immutable.'
        USING ERRCODE = '23514', CONSTRAINT = 'cms_history_append_only';
END;
$$;

CREATE OR REPLACE FUNCTION cms_protect_published_content_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF current_setting('cms.content_delete', true) IS NOT DISTINCT FROM 'on'
       AND OLD.status IN ('ARCHIVED', 'UNPUBLISHED') THEN
        RETURN OLD;
    END IF;
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
"""

REVERSE = r"""
CREATE OR REPLACE FUNCTION cms_reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'CMS workflow history and publication snapshots are immutable.'
        USING ERRCODE = '23514', CONSTRAINT = 'cms_history_append_only';
END;
$$;

CREATE OR REPLACE FUNCTION cms_protect_published_content_delete() RETURNS trigger
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
"""


class Migration(migrations.Migration):

    dependencies = [
        ("cms", "0037_layout_shape_scalar_alternatives"),
    ]

    operations = [
        migrations.RunSQL(FORWARD, REVERSE),
    ]
