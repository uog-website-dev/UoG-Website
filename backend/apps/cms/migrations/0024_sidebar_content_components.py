from django.db import migrations

FORWARD = r"""CREATE OR REPLACE FUNCTION cms_sidebar_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item jsonb; seen text[] := ARRAY[]::text[]; menus text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.site_id IS DISTINCT FROM OLD.site_id THEN
      RAISE EXCEPTION 'Sidebar ownership is immutable' USING ERRCODE='23514', CONSTRAINT='sidebar_owner_immutable';
    END IF;
    NEW.version := OLD.version + 1;
  END IF;
  IF NEW.status = 'ARCHIVED' AND EXISTS(SELECT 1 FROM cms_page WHERE sidebar_id=NEW.id) THEN
    RAISE EXCEPTION 'Assigned sidebar cannot be archived' USING ERRCODE='23514', CONSTRAINT='sidebar_assigned';
  END IF;
  IF jsonb_typeof(NEW.components) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.components) NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Invalid sidebar components' USING ERRCODE='23514', CONSTRAINT='sidebar_components';
  END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(NEW.components) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
       OR item->>'type' NOT IN ('menu','related_pages','recent_posts') OR item->>'type' IS NULL OR item->>'id' IS NULL OR item->>'id' !~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$'
       OR item->>'id' = ANY(seen) THEN
      RAISE EXCEPTION 'Invalid or foreign sidebar component' USING ERRCODE='23514', CONSTRAINT='sidebar_components';
    END IF;
    IF item->>'type'='menu' THEN
      IF (SELECT count(*) FROM jsonb_object_keys(item))<>3 OR item->>'menu_id'=ANY(menus)
         OR NOT EXISTS(SELECT 1 FROM cms_menu m WHERE m.id::text=item->>'menu_id' AND m.site_id=NEW.site_id AND m.is_active AND NOT m.is_global) THEN
        RAISE EXCEPTION 'Invalid Menu reference' USING ERRCODE='23514',CONSTRAINT='sidebar_components';
      END IF;
    ELSE
      IF (SELECT count(*) FROM jsonb_object_keys(item))<>4 OR jsonb_typeof(item->'title') IS DISTINCT FROM 'string' OR length(btrim(item->>'title')) NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION 'Invalid component title or fields' USING ERRCODE='23514',CONSTRAINT='sidebar_components';
      END IF;
      IF item->>'type'='recent_posts' THEN
        IF jsonb_typeof(item->'limit') IS DISTINCT FROM 'number' OR item->>'limit' !~ '^(10|[1-9])$' THEN
          RAISE EXCEPTION 'Invalid Post limit' USING ERRCODE='23514',CONSTRAINT='sidebar_components';
        END IF;
      ELSE
        IF jsonb_typeof(item->'page_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'page_ids')>20 THEN
          RAISE EXCEPTION 'Invalid related Pages' USING ERRCODE='23514',CONSTRAINT='sidebar_components';
        END IF;
        IF (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(item->'page_ids')) OR EXISTS(
          SELECT 1 FROM jsonb_array_elements_text(item->'page_ids') ref
          WHERE NOT EXISTS(SELECT 1 FROM cms_page p JOIN cms_sitecontent c ON c.id=p.sitecontent_ptr_id WHERE p.sitecontent_ptr_id::text=ref AND c.site_id=NEW.site_id AND p.draft_of_id IS NULL)) THEN
          RAISE EXCEPTION 'Foreign or duplicate Page reference' USING ERRCODE='23514',CONSTRAINT='sidebar_components';
        END IF;
      END IF;
    END IF;
    seen := array_append(seen,item->>'id'); menus := array_append(menus,item->>'menu_id');
  END LOOP;
  RETURN NEW;
END $$;
"""
REVERSE = r"""
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM cms_sidebar, jsonb_array_elements(components) component WHERE component->>'type'<>'menu')
 OR EXISTS(SELECT 1 FROM cms_page, jsonb_array_elements(COALESCE(sidebar_snapshot->'components','[]'::jsonb)) component WHERE component->>'type'<>'menu')
 OR EXISTS(SELECT 1 FROM cms_publishedcontentsnapshot, jsonb_array_elements(COALESCE(payload->'sidebar_snapshot'->'components','[]'::jsonb)) component WHERE component->>'type'<>'menu') THEN
  RAISE EXCEPTION 'Remove non-Menu sidebar components and reconcile retained Page snapshots before downgrade';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION cms_sidebar_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item jsonb; seen text[] := ARRAY[]::text[]; menus text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.site_id IS DISTINCT FROM OLD.site_id THEN
      RAISE EXCEPTION 'Sidebar ownership is immutable' USING ERRCODE='23514', CONSTRAINT='sidebar_owner_immutable';
    END IF;
    NEW.version := OLD.version + 1;
  END IF;
  IF NEW.status = 'ARCHIVED' AND EXISTS(SELECT 1 FROM cms_page WHERE sidebar_id=NEW.id) THEN
    RAISE EXCEPTION 'Assigned sidebar cannot be archived' USING ERRCODE='23514', CONSTRAINT='sidebar_assigned';
  END IF;
  IF jsonb_typeof(NEW.components) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.components) NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Invalid sidebar components' USING ERRCODE='23514', CONSTRAINT='sidebar_components';
  END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(NEW.components) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 3
       OR item->>'type' IS DISTINCT FROM 'menu' OR item->>'id' IS NULL OR item->>'id' !~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$'
       OR item->>'id' = ANY(seen) OR item->>'menu_id' = ANY(menus)
       OR NOT EXISTS(SELECT 1 FROM cms_menu m WHERE m.id::text=item->>'menu_id' AND m.site_id=NEW.site_id AND m.is_active AND NOT m.is_global) THEN
      RAISE EXCEPTION 'Invalid or foreign sidebar component' USING ERRCODE='23514', CONSTRAINT='sidebar_components';
    END IF;
    seen := array_append(seen,item->>'id'); menus := array_append(menus,item->>'menu_id');
  END LOOP;
  RETURN NEW;
END $$;
"""

class Migration(migrations.Migration):
    dependencies = [('cms', '0023_reusable_sidebars')]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
