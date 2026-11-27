"""Allow content purge to clear live snapshot provenance FKs.

Archived working drafts keep APPROVED workflow rows that live publication
snapshots still reference. Hard-delete must UPDATE those snapshot FKs to
NULL under cms.content_delete before removing the draft history.
"""

from django.db import migrations


FORWARD = r"""
CREATE OR REPLACE FUNCTION cms_reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF current_setting('cms.content_delete', true) IS NOT DISTINCT FROM 'on'
       AND TG_OP IN ('DELETE', 'UPDATE') THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    RAISE EXCEPTION 'CMS workflow history and publication snapshots are immutable.'
        USING ERRCODE = '23514', CONSTRAINT = 'cms_history_append_only';
END;
$$;
"""

REVERSE = r"""
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
"""


class Migration(migrations.Migration):

    dependencies = [
        ("cms", "0038_allow_archived_content_purge"),
    ]

    operations = [
        migrations.RunSQL(FORWARD, REVERSE),
    ]
