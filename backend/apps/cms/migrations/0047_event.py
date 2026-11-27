import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0010_event_category_kind"),
        ("cms", "0046_retire_primary_from_menu_location_guards"),
        ("media", "0015_document_revision_references"),
        ("sites", "0022_events_module"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Event",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("title", models.CharField(blank=True, default="", max_length=255)),
                ("slug", models.SlugField(blank=True, default="", max_length=255)),
                ("summary", models.CharField(blank=True, default="", max_length=500)),
                ("description", models.TextField(blank=True, default="")),
                ("organizer_name", models.CharField(blank=True, default="", max_length=255)),
                ("organizer_email", models.EmailField(blank=True, default="", max_length=254)),
                ("organizer_phone", models.CharField(blank=True, default="", max_length=64)),
                ("status", models.CharField(choices=[("DRAFT", "Draft"), ("PUBLISHED", "Published"), ("CANCELLED", "Cancelled"), ("ARCHIVED", "Archived")], default="DRAFT", max_length=12)),
                ("starts_at", models.DateTimeField(blank=True, null=True)),
                ("ends_at", models.DateTimeField(blank=True, null=True)),
                ("timezone", models.CharField(blank=True, default="", max_length=64)),
                ("venue", models.CharField(blank=True, default="", max_length=255)),
                ("format", models.CharField(choices=[("PHYSICAL", "Physical"), ("ONLINE", "Online"), ("HYBRID", "Hybrid")], default="PHYSICAL", max_length=12)),
                ("online_url", models.CharField(blank=True, default="", max_length=2048)),
                ("registration_required", models.BooleanField(default=False)),
                ("registration_capacity", models.PositiveIntegerField(blank=True, null=True)),
                ("registration_open", models.BooleanField(default=True)),
                ("cancellation_notice", models.TextField(blank=True, default="")),
                ("published_at", models.DateTimeField(blank=True, null=True)),
                ("cancelled_at", models.DateTimeField(blank=True, null=True)),
                ("version", models.PositiveIntegerField(default=1, editable=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("banner_asset", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="event_banners", to="media.mediaasset")),
                ("category", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="events", to="api.category")),
                ("created_by", models.ForeignKey(editable=False, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to=settings.AUTH_USER_MODEL)),
                ("site", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="events", to="sites.site")),
                ("updated_by", models.ForeignKey(editable=False, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("-starts_at", "-updated_at", "id")},
        ),
        migrations.AddIndex(
            model_name="event",
            index=models.Index(fields=["site", "status"], name="event_site_status"),
        ),
        migrations.AddIndex(
            model_name="event",
            index=models.Index(fields=["site", "starts_at"], name="event_site_starts"),
        ),
        migrations.AddConstraint(
            model_name="event",
            constraint=models.UniqueConstraint(condition=~models.Q(slug=""), fields=("site", "slug"), name="event_site_slug_uniq"),
        ),
        migrations.RunSQL(
            r"""
CREATE FUNCTION cms_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.site_id IS DISTINCT FROM OLD.site_id THEN RAISE EXCEPTION 'Event ownership is immutable.' USING ERRCODE='23514',CONSTRAINT='event_site_immutable'; END IF;
  IF NEW.version IS DISTINCT FROM OLD.version THEN RAISE EXCEPTION 'Event version is server managed.' USING ERRCODE='23514',CONSTRAINT='event_version_managed'; END IF;
  NEW.version:=OLD.version+1;
 ELSE NEW.version:=1; END IF;
 IF NEW.starts_at IS NOT NULL AND NEW.ends_at IS NOT NULL AND NEW.ends_at <= NEW.starts_at THEN
  RAISE EXCEPTION 'Event end must be after start.' USING ERRCODE='23514',CONSTRAINT='event_ends_after_starts';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER event_guard BEFORE INSERT OR UPDATE ON cms_event FOR EACH ROW EXECUTE FUNCTION cms_event_guard();
CREATE FUNCTION cms_event_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous jsonb; current_value jsonb; identifier text;
BEGIN
 IF TG_OP<>'INSERT' THEN previous:=to_jsonb(OLD)-ARRAY['created_at','updated_at','description'];identifier:=OLD.id::text; END IF;
 IF TG_OP<>'DELETE' THEN current_value:=to_jsonb(NEW)-ARRAY['created_at','updated_at','description'];identifier:=NEW.id::text; END IF;
 PERFORM audit_record_event(CASE TG_OP WHEN 'INSERT' THEN 'EVENT_CREATED' WHEN 'DELETE' THEN 'EVENT_DELETED' ELSE 'EVENT_UPDATED' END,'cms.event',identifier,previous,current_value,'["settings"]'::jsonb);
 RETURN NULL;
END $$;
CREATE TRIGGER event_audit AFTER INSERT OR UPDATE OR DELETE ON cms_event FOR EACH ROW EXECUTE FUNCTION cms_event_audit();
""",
            r"""
DROP TRIGGER IF EXISTS event_audit ON cms_event;
DROP FUNCTION IF EXISTS cms_event_audit();
DROP TRIGGER IF EXISTS event_guard ON cms_event;
DROP FUNCTION IF EXISTS cms_event_guard();
""",
        ),
    ]
