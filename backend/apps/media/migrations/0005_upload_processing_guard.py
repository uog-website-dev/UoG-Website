from django.db import migrations

SQL = """
CREATE FUNCTION media_upload_processing_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status='PENDING' AND NEW.status <> OLD.status
       AND EXISTS (SELECT 1 FROM media_mediaupload WHERE asset_id=OLD.id)
       AND current_setting('media.processing', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'Upload processing must complete in the worker.' USING ERRCODE='23514', CONSTRAINT='media_upload_worker_required';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER media_upload_processing BEFORE UPDATE ON media_mediaasset
FOR EACH ROW EXECUTE FUNCTION media_upload_processing_guard();
"""


def editor_permissions(apps, schema_editor):
    using = schema_editor.connection.alias
    role = apps.get_model("authorization", "Role").objects.using(using).filter(code="editor", is_system=True).first()
    if role:
        for permission in apps.get_model("authorization", "Permission").objects.using(using).filter(code__in=["sites.view", "content.media.view", "content.media.upload"], is_system=True):
            apps.get_model("authorization", "RolePermission").objects.using(using).get_or_create(role_id=role.pk, permission_id=permission.pk)


def reverse_editor_permissions(apps, schema_editor):
    apps.get_model("authorization", "RolePermission").objects.using(schema_editor.connection.alias).filter(
        role__code="editor", role__is_system=True, permission__code__in=["sites.view", "content.media.view", "content.media.upload"],
    ).delete()


class Migration(migrations.Migration):
    dependencies = [("media", "0004_mediaupload_mediauploadattempt_and_more")]
    operations = [migrations.RunSQL(SQL, "DROP TRIGGER media_upload_processing ON media_mediaasset; DROP FUNCTION media_upload_processing_guard();"), migrations.RunPython(editor_permissions, reverse_editor_permissions)]
