"""Immutable storage identities, Site-safe placements and transactional audit."""
from django.db import migrations


FORWARD = r"""
CREATE FUNCTION media_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    row_site bigint;
    actor text;
    old_data jsonb;
    new_data jsonb;
BEGIN
    IF TG_TABLE_NAME = 'media_mediaasset' AND TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Archive assets instead of deleting identity.' USING ERRCODE='23514', CONSTRAINT='media_no_delete';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF TG_TABLE_NAME = 'media_mediaassetreference' THEN
            RAISE EXCEPTION 'Placement references are immutable; detach and attach a new reference.' USING ERRCODE='23514', CONSTRAINT='media_reference_immutable';
        END IF;
        IF (NEW.id, NEW.site_id, NEW.storage_reference, NEW.original_filename, NEW.detected_mime,
            NEW.byte_count, NEW.checksum, NEW.width, NEW.height, NEW.created_by_id, NEW.created_at)
            IS DISTINCT FROM
           (OLD.id, OLD.site_id, OLD.storage_reference, OLD.original_filename, OLD.detected_mime,
            OLD.byte_count, OLD.checksum, OLD.width, OLD.height, OLD.created_by_id, OLD.created_at) THEN
            RAISE EXCEPTION 'Asset ownership, identity and technical metadata are immutable.' USING ERRCODE='23514', CONSTRAINT='media_identity_immutable';
        END IF;
    END IF;
    IF current_setting('media.asset_write', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'Use the guarded media services.' USING ERRCODE='23514', CONSTRAINT='media_service_required';
    END IF;
    actor := current_setting('audit.actor_id', true);
    IF current_setting('audit.actor_kind', true) IS DISTINCT FROM 'USER' OR actor IS NULL OR actor = '' THEN
        RAISE EXCEPTION 'A media actor is required.' USING ERRCODE='23514', CONSTRAINT='media_actor_required';
    END IF;
    row_site := CASE WHEN TG_OP='DELETE' THEN OLD.site_id ELSE NEW.site_id END;
    IF EXISTS (SELECT 1 FROM sites_site WHERE id=row_site AND status='ARCHIVED') THEN
        RAISE EXCEPTION 'Archived Sites cannot change media.' USING ERRCODE='23514', CONSTRAINT='media_site_archived';
    END IF;
    IF TG_TABLE_NAME = 'media_mediaasset' THEN
        IF NEW.updated_by_id::text IS DISTINCT FROM actor OR
            (TG_OP='INSERT' AND NEW.created_by_id::text IS DISTINCT FROM actor) THEN
            RAISE EXCEPTION 'Actor must match the media change.' USING ERRCODE='23514', CONSTRAINT='media_actor_mismatch';
        END IF;
        IF split_part(NEW.storage_reference, ':', 1) NOT IN ('platform-public','platform-private','platform-documents')
           OR split_part(NEW.storage_reference, ':', 2) NOT LIKE 'sites/' || NEW.site_id::text || '/%'
           OR NEW.storage_reference !~ '^[a-z-]+:sites/[1-9][0-9]*/[A-Za-z0-9._/-]+$'
           OR NEW.storage_reference ~ '(^|/)(\.|\.\.)(/|$)' OR NEW.storage_reference LIKE '%//%' OR NEW.storage_reference LIKE '%/' THEN
            RAISE EXCEPTION 'Storage namespace must match the owning Site.' USING ERRCODE='23514', CONSTRAINT='media_storage_site';
        END IF;
        IF TG_OP='INSERT' AND NEW.status <> 'PENDING' THEN
            RAISE EXCEPTION 'New assets start pending.' USING ERRCODE='23514', CONSTRAINT='media_initial_status';
        END IF;
        IF TG_OP='UPDATE' AND NEW.status <> OLD.status AND NOT (
            (OLD.status='PENDING' AND NEW.status IN ('READY','REJECTED')) OR
            (OLD.status='READY' AND NEW.status='ARCHIVED') OR
            (OLD.status='ARCHIVED' AND NEW.status='READY')
        ) THEN
            RAISE EXCEPTION 'Illegal asset status transition.' USING ERRCODE='23514', CONSTRAINT='media_status_transition';
        END IF;
    ELSIF TG_OP='INSERT' THEN
        IF NEW.created_by_id::text IS DISTINCT FROM actor THEN
            RAISE EXCEPTION 'Actor must match the reference creator.' USING ERRCODE='23514', CONSTRAINT='media_actor_mismatch';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM media_mediaasset WHERE id=NEW.asset_id AND site_id=NEW.site_id AND status='READY')
           OR NOT EXISTS (
               SELECT 1 FROM cms_contentrevision r JOIN cms_page p ON p.sitecontent_ptr_id=r.content_id
               WHERE r.id=NEW.page_revision_id AND r.site_id=NEW.site_id
           ) THEN
            RAISE EXCEPTION 'Reference must use a ready asset and Page revision owned by this Site.' USING ERRCODE='23514', CONSTRAINT='media_reference_site';
        END IF;
    END IF;
    old_data := CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
    new_data := CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
    PERFORM audit_record_event(
        CASE WHEN TG_TABLE_NAME='media_mediaasset' THEN 'MEDIA_ASSET_' ELSE 'MEDIA_REFERENCE_' END || TG_OP,
        'media.' || CASE WHEN TG_TABLE_NAME='media_mediaasset' THEN 'mediaasset' ELSE 'mediaassetreference' END,
        CASE WHEN TG_OP='DELETE' THEN OLD.id::text ELSE NEW.id::text END,
        old_data, new_data, '[]'::jsonb
    );
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER media_asset_guard BEFORE INSERT OR UPDATE OR DELETE ON media_mediaasset
FOR EACH ROW EXECUTE FUNCTION media_guard();
CREATE TRIGGER media_reference_guard BEFORE INSERT OR UPDATE OR DELETE ON media_mediaassetreference
FOR EACH ROW EXECUTE FUNCTION media_guard();
CREATE TRIGGER media_asset_serialization BEFORE INSERT OR UPDATE OR DELETE ON media_mediaasset
FOR EACH STATEMENT EXECUTE FUNCTION organizations_serialize_hierarchy();
CREATE TRIGGER media_reference_serialization BEFORE INSERT OR UPDATE OR DELETE ON media_mediaassetreference
FOR EACH STATEMENT EXECUTE FUNCTION organizations_serialize_hierarchy();

INSERT INTO sites_module_implementation(code) VALUES ('MEDIA') ON CONFLICT DO NOTHING;
UPDATE sites_module SET status='IMPLEMENTED',
    description='Site-owned asset metadata and Page revision placement references. Object upload and public delivery remain separate capabilities.'
WHERE code='MEDIA';
"""

REVERSE = """
UPDATE sites_module SET is_enabled=false, status='DEPRECATED' WHERE code='MEDIA';
DELETE FROM sites_module_implementation WHERE code='MEDIA';
DROP TRIGGER media_reference_serialization ON media_mediaassetreference;
DROP TRIGGER media_asset_serialization ON media_mediaasset;
DROP TRIGGER media_reference_guard ON media_mediaassetreference;
DROP TRIGGER media_asset_guard ON media_mediaasset;
DROP FUNCTION media_guard();
"""


class Migration(migrations.Migration):
    dependencies = [("media", "0001_initial"), ("audit", "0002_common_writer")]
    operations = [migrations.RunSQL(FORWARD, reverse_sql=REVERSE)]
