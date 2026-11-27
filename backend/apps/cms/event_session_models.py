"""Schedule sessions belonging to a Site-owned Event."""
from __future__ import annotations

import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


class SessionStatus(models.TextChoices):
    SCHEDULED = "SCHEDULED", "Scheduled"
    UPDATED = "UPDATED", "Updated"
    CANCELLED = "CANCELLED", "Cancelled"
    COMPLETED = "COMPLETED", "Completed"


class SessionVisibility(models.TextChoices):
    PUBLIC = "PUBLIC", "Public"
    HIDDEN = "HIDDEN", "Hidden"


class SessionType(models.TextChoices):
    KEYNOTE = "KEYNOTE", "Keynote"
    PANEL = "PANEL", "Panel"
    WORKSHOP = "WORKSHOP", "Workshop"
    BREAK = "BREAK", "Break"
    OTHER = "OTHER", "Other"


class EventSession(models.Model):
    """One timed agenda item inside an Event. Soft-removed rows retain history."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        "cms.Event", on_delete=models.CASCADE, related_name="sessions",
    )
    day_date = models.DateField()
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    session_type = models.CharField(
        max_length=16, choices=SessionType.choices, default=SessionType.OTHER,
    )
    venue_room = models.CharField(max_length=255, blank=True, default="")
    track = models.CharField(max_length=120, blank=True, default="")
    sort_order = models.PositiveIntegerField(default=0)
    visibility = models.CharField(
        max_length=12, choices=SessionVisibility.choices, default=SessionVisibility.PUBLIC,
    )
    status = models.CharField(
        max_length=12, choices=SessionStatus.choices, default=SessionStatus.SCHEDULED,
    )
    public_notes = models.TextField(blank=True, default="")
    # Soft labels for speaker conflict warnings until a dedicated speaker entity ships.
    speaker_labels = models.JSONField(default=list, blank=True)
    media_asset = models.ForeignKey(
        "media.MediaAsset", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="event_sessions",
    )
    document = models.ForeignKey(
        "cms.Document", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="event_sessions",
    )
    removed_at = models.DateTimeField(null=True, blank=True, editable=False)
    version = models.PositiveIntegerField(default=1, editable=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        related_name="+", editable=False,
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        related_name="+", editable=False,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("day_date", "sort_order", "starts_at", "id")
        indexes = [
            models.Index(fields=("event", "day_date", "sort_order"), name="event_session_day_order"),
            models.Index(fields=("event", "removed_at"), name="event_session_removed"),
        ]

    def __str__(self):
        return self.title

    @property
    def is_active(self) -> bool:
        return self.removed_at is None

    def clean(self):
        from apps.cms.event_session_domain import validate_session
        validate_session(self)

    def save(self, *args, **kwargs):
        from apps.organizations.hierarchy_lock import hierarchy_write
        from apps.audit.context import database_audit_context
        with hierarchy_write(), database_audit_context():
            self.full_clean()
            super().save(*args, **kwargs)
            self.refresh_from_db(fields=["version"])
