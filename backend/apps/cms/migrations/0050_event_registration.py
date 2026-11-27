"""Event registration fields, waitlist and EventRegistration inventory."""
import django.db.models.deletion
import uuid
from django.db import migrations, models


def default_required_fields():
    return ["participant_name", "email"]


class Migration(migrations.Migration):

    dependencies = [
        ("cms", "0049_event_person"),
        ("sites", "0022_events_module"),
    ]

    operations = [
        migrations.AddField(
            model_name="event",
            name="registration_opens_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="event",
            name="registration_closes_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="event",
            name="waitlist_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="event",
            name="registration_category",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
        migrations.AddField(
            model_name="event",
            name="registration_required_fields",
            field=models.JSONField(blank=True, default=default_required_fields),
        ),
        migrations.AddField(
            model_name="event",
            name="registration_notice",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.CreateModel(
            name="EventRegistration",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("request_id", models.UUIDField()),
                ("email", models.EmailField(max_length=254)),
                ("email_normalized", models.EmailField(db_index=True, max_length=254)),
                ("participant_name", models.CharField(max_length=200)),
                ("organization", models.CharField(blank=True, default="", max_length=255)),
                ("phone", models.CharField(blank=True, default="", max_length=64)),
                ("status", models.CharField(choices=[("PENDING", "Pending"), ("CONFIRMED", "Confirmed"), ("WAITLISTED", "Waitlisted"), ("CANCELLED", "Cancelled")], default="PENDING", max_length=12)),
                ("consent_at", models.DateTimeField()),
                ("consent_text", models.CharField(blank=True, default="", max_length=500)),
                ("management_token", models.CharField(editable=False, max_length=64)),
                ("waitlist_position", models.PositiveIntegerField(blank=True, null=True)),
                ("notification_status", models.CharField(choices=[("NOT_CONFIGURED", "Not configured"), ("PENDING", "Pending"), ("SENT", "Sent"), ("FAILED", "Failed")], default="NOT_CONFIGURED", max_length=16)),
                ("notification_attempted_at", models.DateTimeField(blank=True, null=True)),
                ("cancelled_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("event", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="registrations", to="cms.event")),
                ("site", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="event_registrations", to="sites.site")),
            ],
            options={
                "ordering": ("created_at", "id"),
            },
        ),
        migrations.AddIndex(
            model_name="eventregistration",
            index=models.Index(fields=["event", "status", "created_at"], name="event_reg_status_idx"),
        ),
        migrations.AddIndex(
            model_name="eventregistration",
            index=models.Index(fields=["site", "-created_at"], name="event_reg_site_created_idx"),
        ),
        migrations.AddConstraint(
            model_name="eventregistration",
            constraint=models.UniqueConstraint(fields=("event", "request_id"), name="event_reg_request_uniq"),
        ),
        migrations.AddConstraint(
            model_name="eventregistration",
            constraint=models.UniqueConstraint(
                condition=models.Q(("status__in", ["PENDING", "CONFIRMED", "WAITLISTED"])),
                fields=("event", "email_normalized"),
                name="event_reg_active_email_uniq",
            ),
        ),
        migrations.AddConstraint(
            model_name="eventregistration",
            constraint=models.CheckConstraint(
                condition=models.Q(("status__in", ["PENDING", "CONFIRMED", "WAITLISTED", "CANCELLED"])),
                name="event_reg_status_valid",
            ),
        ),
        migrations.RunSQL(
            r"""
CREATE FUNCTION cms_event_registration_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM cms_event e WHERE e.id = NEW.event_id AND e.site_id = NEW.site_id) THEN
  RAISE EXCEPTION 'Registration Event must belong to the same Site.' USING ERRCODE='23514', CONSTRAINT='event_reg_site_match';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.site_id IS DISTINCT FROM OLD.site_id OR NEW.request_id IS DISTINCT FROM OLD.request_id THEN
   RAISE EXCEPTION 'Registration ownership is immutable.' USING ERRCODE='23514', CONSTRAINT='event_reg_identity_immutable';
  END IF;
 END IF;
 NEW.email_normalized := lower(btrim(NEW.email));
 IF NEW.email_normalized = '' OR NEW.participant_name = '' THEN
  RAISE EXCEPTION 'Registration email and name are required.' USING ERRCODE='23514', CONSTRAINT='event_reg_identity_required';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER event_registration_guard BEFORE INSERT OR UPDATE ON cms_eventregistration
 FOR EACH ROW EXECUTE FUNCTION cms_event_registration_guard();
CREATE FUNCTION cms_event_registration_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous jsonb; current_value jsonb; identifier text;
BEGIN
 IF TG_OP<>'INSERT' THEN previous:=to_jsonb(OLD)-ARRAY['management_token','updated_at']; identifier:=OLD.id::text; END IF;
 IF TG_OP<>'DELETE' THEN current_value:=to_jsonb(NEW)-ARRAY['management_token','updated_at']; identifier:=NEW.id::text; END IF;
 PERFORM audit_record_event(
  CASE TG_OP WHEN 'INSERT' THEN 'EVENT_REGISTRATION_CREATED' WHEN 'DELETE' THEN 'EVENT_REGISTRATION_DELETED' ELSE 'EVENT_REGISTRATION_UPDATED' END,
  'cms.event_registration', identifier, previous, current_value, '["registration"]'::jsonb
 );
 RETURN NULL;
END $$;
CREATE TRIGGER event_registration_audit AFTER INSERT OR UPDATE OR DELETE ON cms_eventregistration
 FOR EACH ROW EXECUTE FUNCTION cms_event_registration_audit();
""",
            r"""
DROP TRIGGER IF EXISTS event_registration_audit ON cms_eventregistration;
DROP FUNCTION IF EXISTS cms_event_registration_audit();
DROP TRIGGER IF EXISTS event_registration_guard ON cms_eventregistration;
DROP FUNCTION IF EXISTS cms_event_registration_guard();
""",
        ),
    ]
