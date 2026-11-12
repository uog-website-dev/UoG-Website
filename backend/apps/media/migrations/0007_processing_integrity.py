import importlib
from django.db import migrations

BASE = importlib.import_module("apps.media.migrations.0002_integrity").FORWARD.split("CREATE TRIGGER media_asset_guard")[0].replace("CREATE FUNCTION media_guard()", "CREATE OR REPLACE FUNCTION media_guard()")
UPDATED = BASE.replace("(OLD.status='READY' AND NEW.status='ARCHIVED') OR", "(OLD.status='READY' AND NEW.status='ARCHIVED') OR (OLD.status='READY' AND NEW.status='REJECTED' AND current_setting('media.processing', true)='on') OR")

UPDATED = UPDATED.replace("id=NEW.asset_id AND site_id=NEW.site_id AND status='READY')", "id=NEW.asset_id AND site_id=NEW.site_id AND status='READY' AND NOT EXISTS(SELECT 1 FROM media_mediaprocessing WHERE asset_id=NEW.asset_id AND state <> 'READY'))")

SQL = r"""
CREATE FUNCTION media_processing_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE asset_site bigint; owner_id bigint; original_status text; data jsonb;
BEGIN
    SELECT site_id, created_by_id, status INTO asset_site, owner_id, original_status FROM media_mediaasset
      WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.asset_id ELSE NEW.asset_id END;
    IF current_setting('media.asset_write', true) IS DISTINCT FROM 'on'
       OR current_setting('audit.actor_kind', true) IS DISTINCT FROM 'USER'
       OR current_setting('audit.actor_id', true) IS DISTINCT FROM owner_id::text
       OR EXISTS(SELECT 1 FROM sites_site WHERE id=asset_site AND status='ARCHIVED') THEN
        RAISE EXCEPTION 'Use the processing service with the owning Site actor.' USING ERRCODE='23514', CONSTRAINT='media_processing_service';
    END IF;
    IF TG_TABLE_NAME='media_mediaprocessing' AND TG_OP='INSERT' THEN
        IF NEW.state <> 'QUEUED' OR NEW.attempts <> 0 OR original_status NOT IN ('PENDING','READY') THEN
            RAISE EXCEPTION 'New processing starts queued.' USING ERRCODE='23514', CONSTRAINT='media_processing_initial';
        END IF;
    ELSIF current_setting('media.processing', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'Use the image worker.' USING ERRCODE='23514', CONSTRAINT='media_processing_worker';
    END IF;
    IF TG_OP='UPDATE' AND (NEW.asset_id IS DISTINCT FROM OLD.asset_id) THEN
        RAISE EXCEPTION 'Processing ownership is immutable.' USING ERRCODE='23514', CONSTRAINT='media_processing_owner';
    END IF;
    IF TG_TABLE_NAME='media_mediaderivative' AND TG_OP <> 'DELETE' THEN
        IF NEW.storage_reference NOT LIKE 'platform-private:sites/' || asset_site::text || '/derivatives/' || NEW.asset_id::text || '/%'
           OR NEW.variant NOT IN ('thumbnail','display') OR NEW.byte_count <= 0 OR NEW.width <= 0 OR NEW.height <= 0
           OR NEW.checksum !~ '^[a-f0-9]{64}$' THEN
            RAISE EXCEPTION 'Invalid owned derivative.' USING ERRCODE='23514', CONSTRAINT='media_derivative_identity';
        END IF;
        IF TG_OP='UPDATE' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
            RAISE EXCEPTION 'Derivative identities are immutable.' USING ERRCODE='23514', CONSTRAINT='media_derivative_immutable';
        END IF;
    END IF;
    PERFORM audit_record_event('MEDIA_PROCESSING_' || TG_OP, 'media.' || CASE WHEN TG_TABLE_NAME='media_mediaprocessing' THEN 'mediaprocessing' ELSE 'mediaderivative' END,
      CASE WHEN TG_OP='DELETE' THEN OLD.asset_id::text ELSE NEW.asset_id::text END,
      CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) || jsonb_build_object('site_id',asset_site) END,
      CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) || jsonb_build_object('site_id',asset_site) END, '[]'::jsonb);
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER media_processing_guard BEFORE INSERT OR UPDATE OR DELETE ON media_mediaprocessing
FOR EACH ROW EXECUTE FUNCTION media_processing_guard();
CREATE TRIGGER media_derivative_guard BEFORE INSERT OR UPDATE OR DELETE ON media_mediaderivative
FOR EACH ROW EXECUTE FUNCTION media_processing_guard();
"""
REVERSE = """
DROP TRIGGER media_derivative_guard ON media_mediaderivative;
DROP TRIGGER media_processing_guard ON media_mediaprocessing;
DROP FUNCTION media_processing_guard();
"""

class Migration(migrations.Migration):
    dependencies = [("media", "0006_mediaprocessing_mediaderivative")]
    operations = [migrations.RunSQL(UPDATED + SQL, REVERSE + BASE)]
