"""Allow in-place published edits to write a fresh public snapshot.

Published Pages/Posts are saved under cms.apply_working_draft. Snapshot
insert previously required cms.workflow_transition and, for visual layouts,
an exact approval revision — so image/layout saves returned 409 Conflict.
"""

from django.db import migrations


FORWARD = r"""
CREATE OR REPLACE FUNCTION cms_validate_snapshot_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE content_site_id bigint; content_status text; next_version integer;
BEGIN
    IF current_setting('cms.workflow_transition', true) IS DISTINCT FROM 'on'
       AND current_setting('cms.apply_working_draft', true) IS DISTINCT FROM 'on' THEN
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

CREATE OR REPLACE FUNCTION cms_visual_publication_revision_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE a cms_contentworkflowtransition; r cms_contentrevision; source cms_sitecontent; key text;
BEGIN
 IF NOT (NEW.payload->'metadata') ? 'visual_layout' THEN RETURN NEW; END IF;
 -- In-place published edits refresh the live snapshot without a new review.
 IF current_setting('cms.apply_working_draft', true) IS NOT DISTINCT FROM 'on' THEN
  RETURN NEW;
 END IF;
 SELECT * INTO a FROM cms_contentworkflowtransition WHERE id=NEW.approval_id;
 SELECT * INTO r FROM cms_contentrevision WHERE id=NEW.approved_revision_id;
 SELECT * INTO source FROM cms_sitecontent WHERE id=a.content_id;
 IF a.id IS NULL OR r.id IS NULL OR a.to_status<>'APPROVED' OR a.revision_id<>r.id OR r.content_id<>a.content_id OR r.status<>'APPROVED'
  OR source.site_id::text IS DISTINCT FROM NEW.payload->>'site_id'
  OR NOT ((source.id=NEW.content_id AND source.status='PUBLISHED' AND source.revision_number=r.revision_number+1)
   OR (source.status='APPROVED' AND source.revision_number=r.revision_number AND EXISTS(SELECT 1 FROM cms_page WHERE sitecontent_ptr_id=source.id AND draft_of_id=NEW.content_id))) THEN
  RAISE EXCEPTION 'Publication requires its exact approved revision.' USING ERRCODE='23514',CONSTRAINT='cms_visual_publication_approval';
 END IF;
 FOREACH key IN ARRAY ARRAY['title','blocks','blocks_version','metadata','layout','seo','visibility','locale'] LOOP
  IF NEW.payload->key IS DISTINCT FROM r.snapshot->key THEN
   RAISE EXCEPTION 'Publication presentation differs from approval.' USING ERRCODE='23514',CONSTRAINT='cms_visual_publication_payload';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
"""

REVERSE = r"""
CREATE OR REPLACE FUNCTION cms_validate_snapshot_insert() RETURNS trigger
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

CREATE OR REPLACE FUNCTION cms_visual_publication_revision_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE a cms_contentworkflowtransition; r cms_contentrevision; source cms_sitecontent; key text;
BEGIN
 IF NOT (NEW.payload->'metadata') ? 'visual_layout' THEN RETURN NEW; END IF;
 SELECT * INTO a FROM cms_contentworkflowtransition WHERE id=NEW.approval_id;
 SELECT * INTO r FROM cms_contentrevision WHERE id=NEW.approved_revision_id;
 SELECT * INTO source FROM cms_sitecontent WHERE id=a.content_id;
 IF a.id IS NULL OR r.id IS NULL OR a.to_status<>'APPROVED' OR a.revision_id<>r.id OR r.content_id<>a.content_id OR r.status<>'APPROVED'
  OR source.site_id::text IS DISTINCT FROM NEW.payload->>'site_id'
  OR NOT ((source.id=NEW.content_id AND source.status='PUBLISHED' AND source.revision_number=r.revision_number+1)
   OR (source.status='APPROVED' AND source.revision_number=r.revision_number AND EXISTS(SELECT 1 FROM cms_page WHERE sitecontent_ptr_id=source.id AND draft_of_id=NEW.content_id))) THEN
  RAISE EXCEPTION 'Publication requires its exact approved revision.' USING ERRCODE='23514',CONSTRAINT='cms_visual_publication_approval';
 END IF;
 FOREACH key IN ARRAY ARRAY['title','blocks','blocks_version','metadata','layout','seo','visibility','locale'] LOOP
  IF NEW.payload->key IS DISTINCT FROM r.snapshot->key THEN
   RAISE EXCEPTION 'Publication presentation differs from approval.' USING ERRCODE='23514',CONSTRAINT='cms_visual_publication_payload';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("cms", "0039_release_snapshot_provenance_on_purge"),
    ]

    operations = [
        migrations.RunSQL(FORWARD, REVERSE),
    ]
