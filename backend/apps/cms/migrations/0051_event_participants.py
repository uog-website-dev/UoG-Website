"""Participant categories, check-in tokens, invite status, soft-delete retention."""
import secrets

from django.db import migrations, models


def backfill_tokens_and_defaults(apps, schema_editor):
    EventRegistration = apps.get_model("cms", "EventRegistration")
    for row in EventRegistration.objects.all().iterator():
        changed = False
        if not getattr(row, "check_in_token", None):
            row.check_in_token = secrets.token_urlsafe(16)
            changed = True
        if not getattr(row, "display_category", None):
            row.display_category = "PARTICIPANT"
            changed = True
        if not getattr(row, "source", None):
            row.source = "PUBLIC"
            changed = True
        if changed:
            row.save(update_fields=["check_in_token", "display_category", "source"])


class Migration(migrations.Migration):

    dependencies = [
        ("cms", "0050_event_registration"),
    ]

    operations = [
        migrations.AddField(
            model_name="eventregistration",
            name="display_category",
            field=models.CharField(
                choices=[
                    ("PARTICIPANT", "Participant"),
                    ("SPEAKER", "Speaker"),
                    ("VIP", "VIP"),
                    ("MODERATOR", "Moderator"),
                    ("ORGANIZER", "Organizer"),
                ],
                default="PARTICIPANT",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="eventregistration",
            name="source",
            field=models.CharField(
                choices=[
                    ("PUBLIC", "Public"),
                    ("ADMIN_INVITE", "Admin invite"),
                    ("ADMIN_MANUAL", "Admin manual"),
                ],
                default="PUBLIC",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="eventregistration",
            name="check_in_token",
            field=models.CharField(blank=True, default="", editable=False, max_length=64),
        ),
        migrations.AddField(
            model_name="eventregistration",
            name="confirmed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="eventregistration",
            name="deleted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="eventregistration",
            name="consent_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="eventregistration",
            name="status",
            field=models.CharField(
                choices=[
                    ("PENDING", "Pending"),
                    ("CONFIRMED", "Confirmed"),
                    ("WAITLISTED", "Waitlisted"),
                    ("CANCELLED", "Cancelled"),
                    ("INVITED", "Invited"),
                ],
                default="PENDING",
                max_length=12,
            ),
        ),
        migrations.RunPython(backfill_tokens_and_defaults, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="eventregistration",
            name="check_in_token",
            field=models.CharField(editable=False, max_length=64),
        ),
        migrations.RemoveConstraint(
            model_name="eventregistration",
            name="event_reg_active_email_uniq",
        ),
        migrations.RemoveConstraint(
            model_name="eventregistration",
            name="event_reg_status_valid",
        ),
        migrations.AddConstraint(
            model_name="eventregistration",
            constraint=models.UniqueConstraint(
                condition=models.Q(
                    ("status__in", ["PENDING", "CONFIRMED", "WAITLISTED", "INVITED"]),
                    ("deleted_at__isnull", True),
                ),
                fields=("event", "email_normalized"),
                name="event_reg_active_email_uniq",
            ),
        ),
        migrations.AddConstraint(
            model_name="eventregistration",
            constraint=models.UniqueConstraint(
                fields=("event", "check_in_token"),
                name="event_reg_checkin_uniq",
            ),
        ),
        migrations.AddConstraint(
            model_name="eventregistration",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("status__in", ["PENDING", "CONFIRMED", "WAITLISTED", "CANCELLED", "INVITED"])
                ),
                name="event_reg_status_valid",
            ),
        ),
        migrations.AddConstraint(
            model_name="eventregistration",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    (
                        "display_category__in",
                        ["PARTICIPANT", "SPEAKER", "VIP", "MODERATOR", "ORGANIZER"],
                    )
                ),
                name="event_reg_category_valid",
            ),
        ),
        migrations.AddIndex(
            model_name="eventregistration",
            index=models.Index(fields=["event", "display_category"], name="event_reg_category_idx"),
        ),
        migrations.AddIndex(
            model_name="eventregistration",
            index=models.Index(fields=["event", "check_in_token"], name="event_reg_checkin_idx"),
        ),
    ]
