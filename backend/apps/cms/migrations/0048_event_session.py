"""EventSession schedule rows with soft-remove and version guards."""
import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("cms", "0047_event"),
        ("media", "0015_document_revision_references"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="EventSession",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("day_date", models.DateField()),
                ("starts_at", models.DateTimeField()),
                ("ends_at", models.DateTimeField()),
                ("title", models.CharField(max_length=255)),
                ("description", models.TextField(blank=True, default="")),
                (
                    "session_type",
                    models.CharField(
                        choices=[
                            ("KEYNOTE", "Keynote"),
                            ("PANEL", "Panel"),
                            ("WORKSHOP", "Workshop"),
                            ("BREAK", "Break"),
                            ("OTHER", "Other"),
                        ],
                        default="OTHER",
                        max_length=16,
                    ),
                ),
                ("venue_room", models.CharField(blank=True, default="", max_length=255)),
                ("track", models.CharField(blank=True, default="", max_length=120)),
                ("sort_order", models.PositiveIntegerField(default=0)),
                (
                    "visibility",
                    models.CharField(
                        choices=[("PUBLIC", "Public"), ("HIDDEN", "Hidden")],
                        default="PUBLIC",
                        max_length=12,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("SCHEDULED", "Scheduled"),
                            ("UPDATED", "Updated"),
                            ("CANCELLED", "Cancelled"),
                            ("COMPLETED", "Completed"),
                        ],
                        default="SCHEDULED",
                        max_length=12,
                    ),
                ),
                ("public_notes", models.TextField(blank=True, default="")),
                ("speaker_labels", models.JSONField(blank=True, default=list)),
                ("removed_at", models.DateTimeField(blank=True, editable=False, null=True)),
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
                    "document",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="event_sessions",
                        to="cms.document",
                    ),
                ),
                (
                    "event",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="sessions",
                        to="cms.event",
                    ),
                ),
                (
                    "media_asset",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="event_sessions",
                        to="media.mediaasset",
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
            options={
                "ordering": ("day_date", "sort_order", "starts_at", "id"),
            },
        ),
        migrations.AddIndex(
            model_name="eventsession",
            index=models.Index(fields=("event", "day_date", "sort_order"), name="event_session_day_order"),
        ),
        migrations.AddIndex(
            model_name="eventsession",
            index=models.Index(fields=("event", "removed_at"), name="event_session_removed"),
        ),
        migrations.RunSQL(
            r"""
CREATE FUNCTION cms_event_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
   RAISE EXCEPTION 'Event session ownership is immutable.' USING ERRCODE='23514',CONSTRAINT='event_session_event_immutable';
  END IF;
  IF NEW.version IS DISTINCT FROM OLD.version THEN
   RAISE EXCEPTION 'Event session version is server managed.' USING ERRCODE='23514',CONSTRAINT='event_session_version_managed';
  END IF;
  NEW.version:=OLD.version+1;
 ELSE NEW.version:=1; END IF;
 IF NEW.ends_at <= NEW.starts_at THEN
  RAISE EXCEPTION 'Session end must be after start.' USING ERRCODE='23514',CONSTRAINT='event_session_ends_after_starts';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER event_session_guard BEFORE INSERT OR UPDATE ON cms_eventsession
 FOR EACH ROW EXECUTE FUNCTION cms_event_session_guard();
""",
            r"""
DROP TRIGGER IF EXISTS event_session_guard ON cms_eventsession;
DROP FUNCTION IF EXISTS cms_event_session_guard();
""",
        ),
    ]
