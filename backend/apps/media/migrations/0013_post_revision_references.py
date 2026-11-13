"""Reuse the revision reference guard for Site-owned articles."""
import importlib
from django.db import migrations

PREVIOUS = importlib.import_module("apps.media.migrations.0007_processing_integrity").UPDATED
SQL = PREVIOUS.replace(
    "SELECT 1 FROM cms_contentrevision r JOIN cms_page p ON p.sitecontent_ptr_id=r.content_id\n               WHERE r.id=NEW.page_revision_id AND r.site_id=NEW.site_id",
    "SELECT 1 FROM cms_contentrevision r WHERE r.id=NEW.page_revision_id AND r.site_id=NEW.site_id "
    "AND (EXISTS(SELECT 1 FROM cms_page p WHERE p.sitecontent_ptr_id=r.content_id) "
    "OR EXISTS(SELECT 1 FROM api_post p WHERE p.sitecontent_ptr_id=r.content_id))",
).replace("Page revision owned", "content revision owned")

BACKFILL = r"""
DO $$
DECLARE placement record;
    previous_write text := coalesce(current_setting('media.asset_write', true), '');
    previous_actor text := coalesce(current_setting('audit.actor_id', true), '');
    previous_kind text := coalesce(current_setting('audit.actor_kind', true), '');
BEGIN
    PERFORM set_config('media.asset_write', 'on', true);
    PERFORM set_config('audit.actor_kind', 'USER', true);
    FOR placement IN
        SELECT r.id AS revision_id, r.site_id, a.id AS asset_id, a.created_by_id
        FROM cms_contentrevision r
        JOIN api_post p ON p.sitecontent_ptr_id = r.content_id
        JOIN media_mediaasset a ON replace(a.id::text, '-', '') = replace(split_part(r.snapshot->>'featured_media', '/', 4), '-', '')
        WHERE r.snapshot->>'featured_media' ~ '^sites/[1-9][0-9]*/assets/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'
          AND split_part(r.snapshot->>'featured_media', '/', 2) = r.site_id::text
          AND a.site_id = r.site_id AND a.status = 'READY' AND a.deleted_at IS NULL
          AND a.detected_mime IN ('image/png','image/jpeg','image/webp')
          AND NOT EXISTS(SELECT 1 FROM media_mediaprocessing WHERE asset_id=a.id AND state <> 'READY')
          AND NOT EXISTS(SELECT 1 FROM sites_site WHERE id=r.site_id AND status='ARCHIVED')
          AND NOT EXISTS(SELECT 1 FROM media_mediaassetreference WHERE page_revision_id=r.id AND node_id='featured' AND field_path='featured_media' AND repeater_item_id='')
    LOOP
        PERFORM set_config('audit.actor_id', placement.created_by_id::text, true);
        INSERT INTO media_mediaassetreference(id,site_id,asset_id,page_revision_id,node_id,field_path,repeater_item_id,created_by_id,created_at)
        VALUES(gen_random_uuid(),placement.site_id,placement.asset_id,placement.revision_id,'featured','featured_media','',placement.created_by_id,clock_timestamp());
    END LOOP;
    PERFORM set_config('media.asset_write', previous_write, true);
    PERFORM set_config('audit.actor_kind', previous_kind, true);
    PERFORM set_config('audit.actor_id', previous_actor, true);
END $$;
"""


class Migration(migrations.Migration):
    dependencies = [("media", "0012_asset_editable_metadata"), ("api", "0005_post_taxonomy_sitecontent")]
    operations = [migrations.RunSQL(SQL, PREVIOUS), migrations.RunSQL(BACKFILL, migrations.RunSQL.noop)]
