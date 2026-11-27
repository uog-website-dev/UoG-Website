"""Event attendance check-in records and report support."""
import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("cms", "0056_events_loop_grid_source"),
        ("sites", "0022_events_module"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="EventAttendance",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("checked_in_at", models.DateTimeField()),
                ("checked_out_at", models.DateTimeField(blank=True, null=True)),
                (
                    "method",
                    models.CharField(
                        choices=[("MANUAL", "Manual"), ("QR", "QR badge"), ("OVERRIDE", "Authorized override")],
                        max_length=12,
                    ),
                ),
                ("notes", models.CharField(blank=True, default="", max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "event",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="attendances",
                        to="cms.event",
                    ),
                ),
                (
                    "operator",
                    models.ForeignKey(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "registration",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="attendance",
                        to="cms.eventregistration",
                    ),
                ),
                (
                    "site",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="event_attendances",
                        to="sites.site",
                    ),
                ),
            ],
            options={
                "ordering": ("-checked_in_at", "id"),
            },
        ),
        migrations.AddIndex(
            model_name="eventattendance",
            index=models.Index(fields=["event", "-checked_in_at"], name="event_att_event_in_idx"),
        ),
        migrations.AddIndex(
            model_name="eventattendance",
            index=models.Index(fields=["site", "-checked_in_at"], name="event_att_site_in_idx"),
        ),
        migrations.AddConstraint(
            model_name="eventattendance",
            constraint=models.CheckConstraint(
                condition=models.Q(("method__in", ["MANUAL", "QR", "OVERRIDE"])),
                name="event_att_method_valid",
            ),
        ),
        migrations.AddConstraint(
            model_name="eventattendance",
            constraint=models.CheckConstraint(
                condition=models.Q(("checked_out_at__isnull", True))
                | models.Q(("checked_out_at__gte", models.F("checked_in_at"))),
                name="event_att_checkout_after_in",
            ),
        ),
        migrations.RunSQL(
            sql="""
CREATE FUNCTION cms_event_attendance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM cms_eventregistration r
   WHERE r.id = NEW.registration_id AND r.event_id = NEW.event_id AND r.site_id = NEW.site_id
 ) THEN
   RAISE EXCEPTION 'Attendance must reference a same-Event registration.' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER event_attendance_guard BEFORE INSERT OR UPDATE ON cms_eventattendance
 FOR EACH ROW EXECUTE FUNCTION cms_event_attendance_guard();
""",
            reverse_sql="""
DROP TRIGGER IF EXISTS event_attendance_guard ON cms_eventattendance;
DROP FUNCTION IF EXISTS cms_event_attendance_guard();
""",
        ),
    ]
