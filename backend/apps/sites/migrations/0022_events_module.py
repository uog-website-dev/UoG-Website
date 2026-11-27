"""Ship the EVENTS module and Site-owned Event Management settings."""
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def ship_events(apps, schema_editor):
    Module = apps.get_model("sites", "Module")
    Module.objects.get_or_create(
        code="EVENTS",
        defaults={
            "name": "Events",
            "description": "Site Event Management: configure, publish and administer Site-owned Events.",
            "status": "PLANNED",
            "is_enabled": False,
            "configuration_schema": {"schema_version": 1, "properties": []},
        },
    )
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO sites_module_implementation(code) VALUES ('EVENTS') ON CONFLICT DO NOTHING"
        )
    Module.objects.filter(code="EVENTS").update(
        status="IMPLEMENTED",
        is_enabled=True,
        name="Events",
        description="Site Event Management: configure, publish and administer Site-owned Events.",
    )


def unship_events(apps, schema_editor):
    Module = apps.get_model("sites", "Module")
    Module.objects.filter(code="EVENTS").update(
        status="PLANNED",
        is_enabled=False,
        description="Registered events capability. It is not implemented and cannot be enabled for a Site.",
    )
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("DELETE FROM sites_module_implementation WHERE code = 'EVENTS'")


class Migration(migrations.Migration):

    dependencies = [
        ("sites", "0021_merge_documents_and_banner"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SiteEventSettings",
            fields=[
                ("site", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, primary_key=True, related_name="event_settings", serialize=False, to="sites.site")),
                ("timezone", models.CharField(default="Africa/Addis_Ababa", max_length=64)),
                ("public_list_path", models.CharField(default="/events", max_length=2048)),
                ("registration_required_by_default", models.BooleanField(default=False)),
                ("registration_default_capacity", models.PositiveIntegerField(blank=True, null=True)),
                ("public_aggregation_eligible", models.BooleanField(default=False, help_text="When true, University Main may list this Site's published Events. Never grants cross-Site write access.")),
                ("version", models.PositiveIntegerField(default=1, editable=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.ForeignKey(editable=False, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to=settings.AUTH_USER_MODEL)),
                ("updated_by", models.ForeignKey(editable=False, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.RunSQL(
            r"""
CREATE FUNCTION sites_event_settings_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.site_id IS DISTINCT FROM OLD.site_id THEN RAISE EXCEPTION 'Event settings ownership is immutable.' USING ERRCODE='23514',CONSTRAINT='event_settings_site_immutable'; END IF;
  IF NEW.version IS DISTINCT FROM OLD.version THEN RAISE EXCEPTION 'Event settings version is server managed.' USING ERRCODE='23514',CONSTRAINT='event_settings_version_managed'; END IF;
  NEW.version:=OLD.version+1;
 ELSE NEW.version:=1; END IF;
 IF btrim(NEW.timezone)='' THEN RAISE EXCEPTION 'Event timezone is required.' USING ERRCODE='23514',CONSTRAINT='event_settings_timezone'; END IF;
 IF NEW.public_list_path='' OR NEW.public_list_path='/' OR NOT (NEW.public_list_path ~ '^/(?:[a-z0-9][a-z0-9-]{0,63}(?:/[a-z0-9][a-z0-9-]{0,63})*)?$') THEN RAISE EXCEPTION 'Unsafe event public list path.' USING ERRCODE='23514',CONSTRAINT='event_settings_public_list_path'; END IF;
 IF NEW.registration_default_capacity IS NOT NULL AND NEW.registration_default_capacity < 1 THEN RAISE EXCEPTION 'Registration capacity must be at least 1 when set.' USING ERRCODE='23514',CONSTRAINT='event_settings_capacity'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER event_settings_guard BEFORE INSERT OR UPDATE ON sites_siteeventsettings FOR EACH ROW EXECUTE FUNCTION sites_event_settings_guard();
CREATE FUNCTION sites_event_settings_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous jsonb; current_value jsonb; identifier text;
BEGIN
 IF TG_OP<>'INSERT' THEN previous:=to_jsonb(OLD)-ARRAY['created_at','updated_at'];identifier:=OLD.site_id::text; END IF;
 IF TG_OP<>'DELETE' THEN current_value:=to_jsonb(NEW)-ARRAY['created_at','updated_at'];identifier:=NEW.site_id::text; END IF;
 PERFORM audit_record_event(CASE TG_OP WHEN 'INSERT' THEN 'SITE_EVENT_SETTINGS_CREATED' WHEN 'DELETE' THEN 'SITE_EVENT_SETTINGS_DELETED' ELSE 'SITE_EVENT_SETTINGS_UPDATED' END,'sites.event_settings',identifier,previous,current_value,'["settings"]'::jsonb);
 RETURN NULL;
END $$;
CREATE TRIGGER event_settings_audit AFTER INSERT OR UPDATE OR DELETE ON sites_siteeventsettings FOR EACH ROW EXECUTE FUNCTION sites_event_settings_audit();
""",
            r"""
DROP TRIGGER IF EXISTS event_settings_audit ON sites_siteeventsettings;
DROP FUNCTION IF EXISTS sites_event_settings_audit();
DROP TRIGGER IF EXISTS event_settings_guard ON sites_siteeventsettings;
DROP FUNCTION IF EXISTS sites_event_settings_guard();
""",
        ),
        migrations.RunPython(ship_events, unship_events),
    ]
