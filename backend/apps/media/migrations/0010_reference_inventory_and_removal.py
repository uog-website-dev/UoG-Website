"""Current draft/public inventories and serialized tombstone removal."""
import importlib
from django.db import migrations

OLD = importlib.import_module("apps.media.migrations.0007_processing_integrity").UPDATED
NEW = OLD.replace("IF TG_OP='UPDATE' AND NEW.status <> OLD.status AND NOT (", "IF TG_OP='UPDATE' AND NEW.status <> OLD.status AND NOT ((NEW.deleted_at IS NOT NULL AND NEW.status='ARCHIVED' AND current_setting('media.deleting',true)='on') OR ")

SQL = r"""
CREATE FUNCTION media_extract_uses(doc jsonb, owner_site bigint, prefix text DEFAULT 'blocks', depth integer DEFAULT 0)
RETURNS TABLE(asset_id uuid,node_id text,field_path text,repeater_item_id text) LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE b jsonb; item jsonb; n integer := 0; node text; kind text; ref text; field text;
BEGIN
  IF depth > 5 OR jsonb_typeof(doc) <> 'array' THEN RAISE EXCEPTION 'Invalid media tree.' USING ERRCODE='23514'; END IF;
  FOR b IN SELECT value FROM jsonb_array_elements(doc) LOOP
    kind := b->>'type'; node := coalesce(nullif(b->>'id',''),'legacy:' || prefix || '.' || n::text);
    IF kind='image' THEN
      ref := b->>'ref';
      IF ref ~ '^sites/[0-9]+/assets/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        IF ref NOT LIKE 'sites/' || owner_site::text || '/assets/%' THEN RAISE EXCEPTION 'Foreign media reference.' USING ERRCODE='23514'; END IF;
        asset_id := split_part(ref,'/',4)::uuid; node_id:=node; field_path:='ref'; repeater_item_id:=''; RETURN NEXT;
      END IF;
    ELSIF kind IN ('slider','gallery') THEN
      field := CASE WHEN kind='slider' THEN 'slides' ELSE 'images' END;
      FOR item IN SELECT value FROM jsonb_array_elements(b->field) LOOP
        asset_id := (item->>'asset_id')::uuid; node_id:=node; field_path:=field || '.asset_id'; repeater_item_id:=item->>'id';
        IF asset_id IS NULL OR repeater_item_id IS NULL OR repeater_item_id='' THEN RAISE EXCEPTION 'Stable media items are required.' USING ERRCODE='23514'; END IF;
        RETURN NEXT;
      END LOOP;
    ELSIF kind='section' THEN
      RETURN QUERY SELECT * FROM media_extract_uses(b->'children',owner_site,prefix || '.' || n::text || '.children',depth+1);
    END IF;
    n := n+1;
  END LOOP;
END;
$$;

CREATE FUNCTION media_usage_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE aid uuid; sid bigint; before_row jsonb; after_row jsonb;
BEGIN
  PERFORM organizations_lock_hierarchy();
  IF current_setting('media.usage_sync',true) IS DISTINCT FROM 'on' OR TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'Usage sets are maintained by content revisions.' USING ERRCODE='23514',CONSTRAINT='media_usage_service';
  END IF;
  aid := CASE WHEN TG_OP='DELETE' THEN OLD.asset_id ELSE NEW.asset_id END;
  sid := CASE WHEN TG_OP='DELETE' THEN OLD.site_id ELSE NEW.site_id END;
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS(SELECT 1 FROM media_mediaasset a WHERE a.id=aid AND a.site_id=sid AND a.deleted_at IS NULL AND
      (current_setting('media.usage_backfill',true)='on' OR (a.status='READY' AND NOT EXISTS(SELECT 1 FROM media_mediaprocessing j WHERE j.asset_id=a.id AND j.state <> 'READY'))))
      OR NOT EXISTS(SELECT 1 FROM cms_contentrevision r JOIN cms_page p ON p.sitecontent_ptr_id=r.content_id WHERE r.id=NEW.revision_id AND r.content_id=NEW.page_id AND r.site_id=sid)
      OR (NEW.scope='PUBLIC' AND NOT EXISTS(SELECT 1 FROM cms_publishedcontentsnapshot p WHERE p.id=NEW.publication_id AND p.content_id=NEW.page_id))
      OR NEW.scope NOT IN ('DRAFT','PUBLIC') THEN
      RAISE EXCEPTION 'Usage requires an owned, ready asset and revision.' USING ERRCODE='23514',CONSTRAINT='media_usage_site';
    END IF;
  END IF;
  before_row := CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  after_row := CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  PERFORM audit_record_event('MEDIA_USAGE_'||TG_OP,'media.mediausage',aid::text,before_row,after_row,'[]'::jsonb);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$;
CREATE TRIGGER media_usage_guard BEFORE INSERT OR UPDATE OR DELETE ON media_mediausage FOR EACH ROW EXECUTE FUNCTION media_usage_guard();

CREATE FUNCTION media_replace_usage(pid uuid, kind text, rid bigint, pubid bigint, doc jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE sid bigint; actor bigint; old_kind text; old_actor text; old_flag text;
BEGIN
  PERFORM organizations_lock_hierarchy();
  SELECT site_id,coalesce(updated_by_id,created_by_id) INTO sid,actor FROM cms_sitecontent WHERE id=pid;
  old_kind:=current_setting('audit.actor_kind',true); old_actor:=current_setting('audit.actor_id',true); old_flag:=current_setting('media.usage_sync',true);
  PERFORM set_config('audit.actor_kind',CASE WHEN actor IS NULL THEN 'SYSTEM' ELSE 'USER' END,true);
  PERFORM set_config('audit.actor_id',coalesce(actor::text,''),true); PERFORM set_config('media.usage_sync','on',true);
  DELETE FROM media_mediausage WHERE page_id=pid AND scope=kind;
  INSERT INTO media_mediausage(asset_id,site_id,page_id,revision_id,publication_id,scope,node_id,field_path,repeater_item_id,created_by_id)
    SELECT u.asset_id,sid,pid,rid,pubid,kind,u.node_id,u.field_path,u.repeater_item_id,actor FROM media_extract_uses(doc,sid) u;
  PERFORM set_config('media.usage_sync',coalesce(old_flag,''),true); PERFORM set_config('audit.actor_kind',coalesce(old_kind,''),true); PERFORM set_config('audit.actor_id',coalesce(old_actor,''),true);
END;
$$;

CREATE FUNCTION media_sync_content_usage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid bigint; current_status text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM cms_page WHERE sitecontent_ptr_id=NEW.content_id) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='cms_contentrevision' THEN
    PERFORM media_replace_usage(NEW.content_id,'DRAFT',NEW.id,NULL,CASE WHEN NEW.status IN ('PUBLISHED','ARCHIVED') THEN '[]'::jsonb ELSE NEW.snapshot->'blocks' END);
    IF NEW.status <> 'PUBLISHED' THEN PERFORM media_replace_usage(NEW.content_id,'PUBLIC',NEW.id,NULL,'[]'::jsonb); END IF;
  ELSE
    SELECT r.id INTO rid FROM cms_contentrevision r WHERE r.content_id=NEW.content_id ORDER BY r.revision_number DESC LIMIT 1;
    SELECT status INTO current_status FROM cms_sitecontent WHERE id=NEW.content_id;
    IF current_status='PUBLISHED' THEN
      PERFORM media_replace_usage(NEW.content_id,'PUBLIC',rid,NEW.id,NEW.payload->'blocks');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER media_revision_usage AFTER INSERT ON cms_contentrevision FOR EACH ROW EXECUTE FUNCTION media_sync_content_usage();
CREATE TRIGGER media_publication_usage AFTER INSERT ON cms_publishedcontentsnapshot FOR EACH ROW EXECUTE FUNCTION media_sync_content_usage();
CREATE TRIGGER media_content_serialization BEFORE INSERT OR UPDATE OR DELETE ON cms_sitecontent FOR EACH STATEMENT EXECUTE FUNCTION organizations_serialize_hierarchy();
CREATE TRIGGER media_revision_serialization BEFORE INSERT OR UPDATE OR DELETE ON cms_contentrevision FOR EACH STATEMENT EXECUTE FUNCTION organizations_serialize_hierarchy();
CREATE TRIGGER media_publication_serialization BEFORE INSERT OR UPDATE OR DELETE ON cms_publishedcontentsnapshot FOR EACH STATEMENT EXECUTE FUNCTION organizations_serialize_hierarchy();

CREATE FUNCTION media_removal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'Deleted asset tombstones are immutable.' USING ERRCODE='23514',CONSTRAINT='media_deleted_immutable';
  END IF;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.deleted_by_id IS DISTINCT FROM OLD.deleted_by_id THEN
    IF current_setting('media.deleting',true) IS DISTINCT FROM 'on' OR NEW.deleted_at IS NULL OR NEW.status <> 'ARCHIVED' OR NEW.deleted_by_id::text IS DISTINCT FROM current_setting('audit.actor_id',true) THEN
      RAISE EXCEPTION 'Use guarded asset removal.' USING ERRCODE='23514',CONSTRAINT='media_deletion_service';
    END IF;
  END IF;
  IF (NEW.status='ARCHIVED' AND NEW.status IS DISTINCT FROM OLD.status) OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    IF EXISTS(SELECT 1 FROM media_mediausage WHERE asset_id=OLD.id) OR EXISTS(SELECT 1 FROM media_mediaassetreference WHERE asset_id=OLD.id) THEN
      RAISE EXCEPTION 'Referenced assets cannot be removed.' USING ERRCODE='23514',CONSTRAINT='media_asset_referenced';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER media_removal_guard BEFORE UPDATE ON media_mediaasset FOR EACH ROW EXECUTE FUNCTION media_removal_guard();

CREATE FUNCTION media_cleanup_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid bigint;
BEGIN
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND (NEW.asset_id,NEW.requested_by_id) IS DISTINCT FROM (OLD.asset_id,OLD.requested_by_id)) THEN
    RAISE EXCEPTION 'Cleanup identity is immutable.' USING ERRCODE='23514';
  END IF;
  SELECT site_id INTO sid FROM media_mediaasset WHERE id=NEW.asset_id AND deleted_at IS NOT NULL;
  IF sid IS NULL OR current_setting('media.cleanup_write',true) IS DISTINCT FROM 'on' OR current_setting('audit.actor_id',true) IS DISTINCT FROM NEW.requested_by_id::text THEN
    RAISE EXCEPTION 'Use committed removal cleanup.' USING ERRCODE='23514';
  END IF;
  PERFORM audit_record_event('MEDIA_CLEANUP_'||TG_OP,'media.mediacleanup',NEW.asset_id::text,
    CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD)||jsonb_build_object('site_id',sid) END,
    to_jsonb(NEW)||jsonb_build_object('site_id',sid),'[]'::jsonb);
  RETURN NEW;
END;
$$;
CREATE TRIGGER media_cleanup_guard BEFORE INSERT OR UPDATE OR DELETE ON media_mediacleanup FOR EACH ROW EXECUTE FUNCTION media_cleanup_guard();

CREATE FUNCTION media_lifecycle_cache_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
   UPDATE cms_sitepublicationversion SET version=version+1,updated_at=clock_timestamp() WHERE site_id=NEW.site_id;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER media_lifecycle_cache_generation AFTER UPDATE ON media_mediaasset FOR EACH ROW EXECUTE FUNCTION media_lifecycle_cache_generation();

-- Backfill current sets, not historical draft/publication snapshots.
DO $$ DECLARE p record; r record; pub record;
BEGIN
 PERFORM set_config('media.usage_backfill','on',true);
 FOR p IN SELECT c.id,c.status FROM cms_page x JOIN cms_sitecontent c ON c.id=x.sitecontent_ptr_id LOOP
  SELECT * INTO r FROM cms_contentrevision WHERE content_id=p.id ORDER BY revision_number DESC LIMIT 1;
  IF r.id IS NOT NULL THEN
   PERFORM media_replace_usage(p.id,'DRAFT',r.id,NULL,CASE WHEN p.status IN ('PUBLISHED','ARCHIVED') THEN '[]'::jsonb ELSE r.snapshot->'blocks' END);
   IF p.status='PUBLISHED' THEN
    SELECT * INTO pub FROM cms_publishedcontentsnapshot WHERE content_id=p.id ORDER BY version DESC LIMIT 1;
    IF pub.id IS NOT NULL THEN PERFORM media_replace_usage(p.id,'PUBLIC',r.id,pub.id,pub.payload->'blocks'); END IF;
   END IF;
  END IF;
 END LOOP;
 PERFORM set_config('media.usage_backfill','',true);
END $$;
"""

REVERSE = """
DROP TRIGGER media_lifecycle_cache_generation ON media_mediaasset; DROP FUNCTION media_lifecycle_cache_generation();
DROP TRIGGER media_cleanup_guard ON media_mediacleanup; DROP FUNCTION media_cleanup_guard();
DROP TRIGGER media_removal_guard ON media_mediaasset; DROP FUNCTION media_removal_guard();
DROP TRIGGER media_publication_serialization ON cms_publishedcontentsnapshot;
DROP TRIGGER media_revision_serialization ON cms_contentrevision;
DROP TRIGGER media_content_serialization ON cms_sitecontent;
DROP TRIGGER media_publication_usage ON cms_publishedcontentsnapshot;
DROP TRIGGER media_revision_usage ON cms_contentrevision;
DROP FUNCTION media_sync_content_usage(); DROP TRIGGER media_usage_guard ON media_mediausage;
DROP FUNCTION media_usage_guard(); DROP FUNCTION media_replace_usage(uuid,text,bigint,bigint,jsonb);
DROP FUNCTION media_extract_uses(jsonb,bigint,text,integer);
"""

class Migration(migrations.Migration):
 dependencies=[("media","0009_mediaasset_deleted_at_mediaasset_deleted_by_and_more"),("cms","0013_media_repeater_blocks")]
 operations=[migrations.RunSQL(NEW+SQL,REVERSE+OLD)]
