"""EventPerson profiles and SessionPerson role assignments."""
import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("cms", "0048_event_session"),
        ("media", "0015_document_revision_references"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="EventPerson",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("display_name", models.CharField(max_length=255)),
                ("affiliation", models.CharField(blank=True, default="", max_length=255)),
                ("biography", models.TextField(blank=True, default="")),
                ("public_links", models.JSONField(blank=True, default=list)),
                (
                    "visibility",
                    models.CharField(
                        choices=[("PUBLIC", "Public"), ("HIDDEN", "Hidden")],
                        default="PUBLIC",
                        max_length=12,
                    ),
                ),
                ("private_email", models.EmailField(blank=True, default="", max_length=254)),
                ("private_phone", models.CharField(blank=True, default="", max_length=64)),
                ("sort_order", models.PositiveIntegerField(default=0)),
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
                    "event",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="people",
                        to="cms.event",
                    ),
                ),
                (
                    "profile_photo",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="event_person_portraits",
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
                (
                    "verified_account",
                    models.ForeignKey(
                        blank=True,
                        help_text="Optional explicit link to a platform account; never inferred from email.",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="event_person_profiles",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ("sort_order", "display_name", "id")},
        ),
        migrations.CreateModel(
            name="SessionPerson",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                (
                    "role",
                    models.CharField(
                        choices=[
                            ("SPEAKER", "Speaker"),
                            ("MODERATOR", "Moderator"),
                            ("PANELIST", "Panelist"),
                            ("ORGANIZER", "Organizer"),
                        ],
                        default="SPEAKER",
                        max_length=16,
                    ),
                ),
                ("sort_order", models.PositiveIntegerField(default=0)),
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
                    "person",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="session_assignments",
                        to="cms.eventperson",
                    ),
                ),
                (
                    "session",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="person_assignments",
                        to="cms.eventsession",
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
            options={"ordering": ("sort_order", "role", "id")},
        ),
        migrations.AddIndex(
            model_name="eventperson",
            index=models.Index(fields=("event", "removed_at"), name="event_person_removed"),
        ),
        migrations.AddIndex(
            model_name="eventperson",
            index=models.Index(fields=("event", "sort_order"), name="event_person_order"),
        ),
        migrations.AddIndex(
            model_name="sessionperson",
            index=models.Index(fields=("session", "sort_order"), name="session_person_order"),
        ),
        migrations.AddIndex(
            model_name="sessionperson",
            index=models.Index(fields=("person", "session"), name="session_person_lookup"),
        ),
        migrations.AddConstraint(
            model_name="sessionperson",
            constraint=models.UniqueConstraint(
                fields=("session", "person", "role"), name="session_person_role_uniq",
            ),
        ),
        migrations.RunSQL(
            r"""
CREATE FUNCTION cms_event_person_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
   RAISE EXCEPTION 'Event person ownership is immutable.' USING ERRCODE='23514',CONSTRAINT='event_person_event_immutable';
  END IF;
  IF NEW.version IS DISTINCT FROM OLD.version THEN
   RAISE EXCEPTION 'Event person version is server managed.' USING ERRCODE='23514',CONSTRAINT='event_person_version_managed';
  END IF;
  NEW.version:=OLD.version+1;
 ELSE NEW.version:=1; END IF;
 IF btrim(NEW.display_name)='' THEN
  RAISE EXCEPTION 'Event person display name is required.' USING ERRCODE='23514',CONSTRAINT='event_person_display_name';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER event_person_guard BEFORE INSERT OR UPDATE ON cms_eventperson
 FOR EACH ROW EXECUTE FUNCTION cms_event_person_guard();
""",
            r"""
DROP TRIGGER IF EXISTS event_person_guard ON cms_eventperson;
DROP FUNCTION IF EXISTS cms_event_person_guard();
""",
        ),
    ]
