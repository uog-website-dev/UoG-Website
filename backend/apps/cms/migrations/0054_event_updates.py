"""Event updates (notices) and session revision history."""
import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("cms", "0053_event_gallery"),
        ("sites", "0022_events_module"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="EventUpdate",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("title", models.CharField(max_length=255)),
                ("body", models.TextField(blank=True, default="")),
                (
                    "severity",
                    models.CharField(
                        choices=[("INFO", "Info"), ("IMPORTANT", "Important"), ("URGENT", "Urgent")],
                        default="INFO",
                        max_length=12,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("DRAFT", "Draft"),
                            ("PUBLISHED", "Published"),
                            ("UNPUBLISHED", "Unpublished"),
                        ],
                        default="DRAFT",
                        max_length=12,
                    ),
                ),
                ("pinned", models.BooleanField(default=False)),
                ("published_at", models.DateTimeField(blank=True, null=True)),
                ("unpublished_at", models.DateTimeField(blank=True, null=True)),
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
                        related_name="updates",
                        to="cms.event",
                    ),
                ),
                (
                    "site",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="event_updates",
                        to="sites.site",
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
                "ordering": ("-pinned", "-published_at", "-created_at", "id"),
            },
        ),
        migrations.CreateModel(
            name="EventSessionRevision",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("session_version", models.PositiveIntegerField()),
                ("before", models.JSONField(default=dict)),
                ("after", models.JSONField(default=dict)),
                ("changed_fields", models.JSONField(default=list)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "actor",
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
                        related_name="session_revisions",
                        to="cms.event",
                    ),
                ),
                (
                    "session",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="revisions",
                        to="cms.eventsession",
                    ),
                ),
                (
                    "site",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="event_session_revisions",
                        to="sites.site",
                    ),
                ),
            ],
            options={
                "ordering": ("-created_at", "-session_version", "id"),
            },
        ),
        migrations.AddIndex(
            model_name="eventupdate",
            index=models.Index(fields=["event", "status", "-published_at"], name="event_upd_status_pub_idx"),
        ),
        migrations.AddIndex(
            model_name="eventupdate",
            index=models.Index(fields=["site", "-created_at"], name="event_upd_site_created_idx"),
        ),
        migrations.AddIndex(
            model_name="eventupdate",
            index=models.Index(fields=["event", "-pinned", "-published_at"], name="event_upd_pin_pub_idx"),
        ),
        migrations.AddIndex(
            model_name="eventsessionrevision",
            index=models.Index(fields=["session", "-created_at"], name="event_sess_rev_session_idx"),
        ),
        migrations.AddIndex(
            model_name="eventsessionrevision",
            index=models.Index(fields=["event", "-created_at"], name="event_sess_rev_event_idx"),
        ),
        migrations.AddConstraint(
            model_name="eventupdate",
            constraint=models.CheckConstraint(
                condition=models.Q(("severity__in", ["INFO", "IMPORTANT", "URGENT"])),
                name="event_upd_severity_valid",
            ),
        ),
        migrations.AddConstraint(
            model_name="eventupdate",
            constraint=models.CheckConstraint(
                condition=models.Q(("status__in", ["DRAFT", "PUBLISHED", "UNPUBLISHED"])),
                name="event_upd_status_valid",
            ),
        ),
        migrations.RunSQL(
            r"""
CREATE FUNCTION cms_event_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM cms_event e WHERE e.id = NEW.event_id AND e.site_id = NEW.site_id) THEN
  RAISE EXCEPTION 'Update Event must belong to the same Site.' USING ERRCODE='23514', CONSTRAINT='event_upd_site_match';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.site_id IS DISTINCT FROM OLD.site_id THEN
   RAISE EXCEPTION 'Update ownership is immutable.' USING ERRCODE='23514', CONSTRAINT='event_upd_identity_immutable';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER event_update_guard BEFORE INSERT OR UPDATE ON cms_eventupdate
 FOR EACH ROW EXECUTE FUNCTION cms_event_update_guard();
CREATE FUNCTION cms_event_session_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM cms_event e WHERE e.id = NEW.event_id AND e.site_id = NEW.site_id) THEN
  RAISE EXCEPTION 'Session revision Event must belong to the same Site.' USING ERRCODE='23514', CONSTRAINT='event_sess_rev_site';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM cms_eventsession s WHERE s.id = NEW.session_id AND s.event_id = NEW.event_id) THEN
  RAISE EXCEPTION 'Session revision must belong to the Event.' USING ERRCODE='23514', CONSTRAINT='event_sess_rev_session';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER event_session_revision_guard BEFORE INSERT OR UPDATE ON cms_eventsessionrevision
 FOR EACH ROW EXECUTE FUNCTION cms_event_session_revision_guard();
""",
            r"""
DROP TRIGGER IF EXISTS event_session_revision_guard ON cms_eventsessionrevision;
DROP FUNCTION IF EXISTS cms_event_session_revision_guard();
DROP TRIGGER IF EXISTS event_update_guard ON cms_eventupdate;
DROP FUNCTION IF EXISTS cms_event_update_guard();
""",
        ),
    ]
