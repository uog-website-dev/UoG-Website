"""Event notices / agenda change announcements."""
from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class UpdateSeverity(models.TextChoices):
    INFO = "INFO", "Info"
    IMPORTANT = "IMPORTANT", "Important"
    URGENT = "URGENT", "Urgent"


class UpdateStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    PUBLISHED = "PUBLISHED", "Published"
    UNPUBLISHED = "UNPUBLISHED", "Unpublished"


class EventUpdate(models.Model):
    """Site-scoped Event notice. Independent of root Event publication."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        "cms.Event", on_delete=models.CASCADE, related_name="updates",
    )
    site = models.ForeignKey(
        "sites.Site", on_delete=models.PROTECT, related_name="event_updates",
    )
    title = models.CharField(max_length=255)
    body = models.TextField(blank=True, default="")
    severity = models.CharField(
        max_length=12, choices=UpdateSeverity.choices, default=UpdateSeverity.INFO,
    )
    status = models.CharField(
        max_length=12, choices=UpdateStatus.choices, default=UpdateStatus.DRAFT,
    )
    pinned = models.BooleanField(default=False)
    published_at = models.DateTimeField(null=True, blank=True)
    unpublished_at = models.DateTimeField(null=True, blank=True)
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
        ordering = ("-pinned", "-published_at", "-created_at", "id")
        indexes = [
            models.Index(fields=("event", "status", "-published_at"), name="event_upd_status_pub_idx"),
            models.Index(fields=("site", "-created_at"), name="event_upd_site_created_idx"),
            models.Index(fields=("event", "-pinned", "-published_at"), name="event_upd_pin_pub_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(severity__in=["INFO", "IMPORTANT", "URGENT"]),
                name="event_upd_severity_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=["DRAFT", "PUBLISHED", "UNPUBLISHED"]),
                name="event_upd_status_valid",
            ),
        ]

    def __str__(self):
        return f"{self.title} ({self.status})"


class EventSessionRevision(models.Model):
    """Append-only revision history for controlled session schedule edits."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(
        "cms.EventSession", on_delete=models.CASCADE, related_name="revisions",
    )
    event = models.ForeignKey(
        "cms.Event", on_delete=models.CASCADE, related_name="session_revisions",
    )
    site = models.ForeignKey(
        "sites.Site", on_delete=models.PROTECT, related_name="event_session_revisions",
    )
    session_version = models.PositiveIntegerField()
    before = models.JSONField(default=dict)
    after = models.JSONField(default=dict)
    changed_fields = models.JSONField(default=list)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        related_name="+", editable=False,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "-session_version", "id")
        indexes = [
            models.Index(fields=("session", "-created_at"), name="event_sess_rev_session_idx"),
            models.Index(fields=("event", "-created_at"), name="event_sess_rev_event_idx"),
        ]
