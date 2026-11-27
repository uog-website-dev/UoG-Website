"""Ship the STAFF_DIRECTORY module and Site-owned Staff Directory settings."""
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def ship_staff_directory(apps, schema_editor):
    Module = apps.get_model("sites", "Module")
    Module.objects.get_or_create(
        code="STAFF_DIRECTORY",
        defaults={
            "name": "Staff directory",
            "description": "Site Staff Directory: configure public directory scope and presentation.",
            "status": "PLANNED",
            "is_enabled": False,
            "configuration_schema": {"schema_version": 1, "properties": []},
        },
    )
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO sites_module_implementation(code) VALUES ('STAFF_DIRECTORY') ON CONFLICT DO NOTHING"
        )
    Module.objects.filter(code="STAFF_DIRECTORY").update(
        status="IMPLEMENTED",
        is_enabled=True,
        name="Staff directory",
        description=(
            "Site Staff Directory: configure directory presentation, public route, "
            "organization scope, and optional University Main aggregation eligibility."
        ),
    )


def unship_staff_directory(apps, schema_editor):
    Module = apps.get_model("sites", "Module")
    Module.objects.filter(code="STAFF_DIRECTORY").update(
        status="PLANNED",
        is_enabled=False,
        description=(
            "Registered staff-directory capability. It is not implemented and cannot be "
            "enabled for a Site."
        ),
    )
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("DELETE FROM sites_module_implementation WHERE code = 'STAFF_DIRECTORY'")


class Migration(migrations.Migration):

    dependencies = [
        ("sites", "0023_event_session_settings"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SiteStaffDirectorySettings",
            fields=[
                (
                    "site",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        primary_key=True,
                        related_name="staff_directory_settings",
                        serialize=False,
                        to="sites.site",
                    ),
                ),
                ("page_size", models.PositiveIntegerField(default=20)),
                (
                    "default_sort",
                    models.CharField(
                        choices=[
                            ("NAME_ASC", "Name (A–Z)"),
                            ("NAME_DESC", "Name (Z–A)"),
                            ("TITLE_ASC", "Title (A–Z)"),
                            ("DEPARTMENT_ASC", "Department (A–Z)"),
                        ],
                        default="NAME_ASC",
                        max_length=32,
                    ),
                ),
                ("public_list_path", models.CharField(default="/staff", max_length=2048)),
                (
                    "presentation",
                    models.CharField(
                        choices=[("LIST", "List"), ("CARDS", "Cards")],
                        default="LIST",
                        max_length=16,
                    ),
                ),
                (
                    "public_aggregation_eligible",
                    models.BooleanField(
                        default=False,
                        help_text=(
                            "When true, University Main may include this Site's public directory "
                            "entries. Never grants cross-Site write access."
                        ),
                    ),
                ),
                ("version", models.PositiveIntegerField(default=1, editable=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "updated_by",
                    models.ForeignKey(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
        migrations.RunSQL(
            r"""
CREATE FUNCTION sites_staff_directory_settings_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.site_id IS DISTINCT FROM OLD.site_id THEN RAISE EXCEPTION 'Staff Directory settings ownership is immutable.' USING ERRCODE='23514',CONSTRAINT='staff_directory_settings_site_immutable'; END IF;
  IF NEW.version IS DISTINCT FROM OLD.version THEN RAISE EXCEPTION 'Staff Directory settings version is server managed.' USING ERRCODE='23514',CONSTRAINT='staff_directory_settings_version_managed'; END IF;
  NEW.version:=OLD.version+1;
 ELSE NEW.version:=1; END IF;
 IF NEW.page_size < 5 OR NEW.page_size > 100 THEN RAISE EXCEPTION 'Staff Directory page size must be between 5 and 100.' USING ERRCODE='23514',CONSTRAINT='staff_directory_settings_page_size'; END IF;
 IF NEW.default_sort NOT IN ('NAME_ASC','NAME_DESC','TITLE_ASC','DEPARTMENT_ASC') THEN RAISE EXCEPTION 'Unsupported Staff Directory sort.' USING ERRCODE='23514',CONSTRAINT='staff_directory_settings_sort'; END IF;
 IF NEW.presentation NOT IN ('LIST','CARDS') THEN RAISE EXCEPTION 'Unsupported Staff Directory presentation.' USING ERRCODE='23514',CONSTRAINT='staff_directory_settings_presentation'; END IF;
 IF NEW.public_list_path='' OR NEW.public_list_path='/' OR NOT (NEW.public_list_path ~ '^/(?:[a-z0-9][a-z0-9-]{0,63}(?:/[a-z0-9][a-z0-9-]{0,63})*)?$') THEN RAISE EXCEPTION 'Unsafe Staff Directory public list path.' USING ERRCODE='23514',CONSTRAINT='staff_directory_settings_public_list_path'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER staff_directory_settings_guard BEFORE INSERT OR UPDATE ON sites_sitestaffdirectorysettings FOR EACH ROW EXECUTE FUNCTION sites_staff_directory_settings_guard();
CREATE FUNCTION sites_staff_directory_settings_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous jsonb; current_value jsonb; identifier text;
BEGIN
 IF TG_OP<>'INSERT' THEN previous:=to_jsonb(OLD)-ARRAY['created_at','updated_at'];identifier:=OLD.site_id::text; END IF;
 IF TG_OP<>'DELETE' THEN current_value:=to_jsonb(NEW)-ARRAY['created_at','updated_at'];identifier:=NEW.site_id::text; END IF;
 PERFORM audit_record_event(CASE TG_OP WHEN 'INSERT' THEN 'SITE_STAFF_DIRECTORY_SETTINGS_CREATED' WHEN 'DELETE' THEN 'SITE_STAFF_DIRECTORY_SETTINGS_DELETED' ELSE 'SITE_STAFF_DIRECTORY_SETTINGS_UPDATED' END,'sites.staff_directory_settings',identifier,previous,current_value,'["settings"]'::jsonb);
 RETURN NULL;
END $$;
CREATE TRIGGER staff_directory_settings_audit AFTER INSERT OR UPDATE OR DELETE ON sites_sitestaffdirectorysettings FOR EACH ROW EXECUTE FUNCTION sites_staff_directory_settings_audit();
""",
            r"""
DROP TRIGGER IF EXISTS staff_directory_settings_audit ON sites_sitestaffdirectorysettings;
DROP FUNCTION IF EXISTS sites_staff_directory_settings_audit();
DROP TRIGGER IF EXISTS staff_directory_settings_guard ON sites_sitestaffdirectorysettings;
DROP FUNCTION IF EXISTS sites_staff_directory_settings_guard();
""",
        ),
        migrations.RunPython(ship_staff_directory, unship_staff_directory),
    ]
