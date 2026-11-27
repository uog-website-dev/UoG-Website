"""Event attendance / check-in records bound to registrations."""
from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class AttendanceMethod(models.TextChoices):
    MANUAL = "MANUAL", "Manual"
    QR = "QR", "QR badge"
    OVERRIDE = "OVERRIDE", "Authorized override"


class EventAttendance(models.Model):
    """One attendance row per registration. Replays return the same row."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        "cms.Event", on_delete=models.CASCADE, related_name="attendances",
    )
    site = models.ForeignKey(
        "sites.Site", on_delete=models.PROTECT, related_name="event_attendances",
    )
    registration = models.OneToOneField(
        "cms.EventRegistration",
        on_delete=models.CASCADE,
        related_name="attendance",
    )
    checked_in_at = models.DateTimeField()
    checked_out_at = models.DateTimeField(null=True, blank=True)
    method = models.CharField(max_length=12, choices=AttendanceMethod.choices)
    operator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="+",
        editable=False,
    )
    notes = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-checked_in_at", "id")
        indexes = [
            models.Index(fields=("event", "-checked_in_at"), name="event_att_event_in_idx"),
            models.Index(fields=("site", "-checked_in_at"), name="event_att_site_in_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(method__in=["MANUAL", "QR", "OVERRIDE"]),
                name="event_att_method_valid",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(checked_out_at__isnull=True)
                    | models.Q(checked_out_at__gte=models.F("checked_in_at"))
                ),
                name="event_att_checkout_after_in",
            ),
        ]

    def __str__(self):
        return f"Attendance {self.registration_id} ({self.method})"
