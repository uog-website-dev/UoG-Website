"""Event-scoped people (speakers, moderators) and session role assignments."""
from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class SessionPersonRole(models.TextChoices):
    SPEAKER = "SPEAKER", "Speaker"
    MODERATOR = "MODERATOR", "Moderator"
    PANELIST = "PANELIST", "Panelist"
    ORGANIZER = "ORGANIZER", "Organizer"


class EventPerson(models.Model):
    """One speaker/moderator/organizer profile belonging to an Event.

    Profiles are independent from registration accounts. An optional verified
    account link is explicit and never implied by email match.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        "cms.Event", on_delete=models.CASCADE, related_name="people",
    )
    display_name = models.CharField(max_length=255)
    affiliation = models.CharField(max_length=255, blank=True, default="")
    biography = models.TextField(blank=True, default="")
    profile_photo = models.ForeignKey(
        "media.MediaAsset", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="event_person_portraits",
    )
    public_links = models.JSONField(default=list, blank=True)
    # Reuse session visibility vocabulary (PUBLIC/HIDDEN) to keep OpenAPI enums unique.
    visibility = models.CharField(
        max_length=12,
        choices=[("PUBLIC", "Public"), ("HIDDEN", "Hidden")],
        default="PUBLIC",
    )
    private_email = models.EmailField(blank=True, default="")
    private_phone = models.CharField(max_length=64, blank=True, default="")
    verified_account = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="event_person_profiles",
        help_text="Optional explicit link to a platform account; never inferred from email.",
    )
    sort_order = models.PositiveIntegerField(default=0)
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
        ordering = ("sort_order", "display_name", "id")
        indexes = [
            models.Index(fields=("event", "removed_at"), name="event_person_removed"),
            models.Index(fields=("event", "sort_order"), name="event_person_order"),
        ]

    def __str__(self):
        return self.display_name

    @property
    def is_active(self) -> bool:
        return self.removed_at is None

    def clean(self):
        from apps.cms.event_person_domain import validate_person
        validate_person(self)

    def save(self, *args, **kwargs):
        from apps.organizations.hierarchy_lock import hierarchy_write
        from apps.audit.context import database_audit_context
        with hierarchy_write(), database_audit_context():
            self.full_clean()
            super().save(*args, **kwargs)
            self.refresh_from_db(fields=["version"])


class SessionPerson(models.Model):
    """Role assignment of an EventPerson onto one EventSession."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(
        "cms.EventSession", on_delete=models.CASCADE, related_name="person_assignments",
    )
    person = models.ForeignKey(
        EventPerson, on_delete=models.CASCADE, related_name="session_assignments",
    )
    role = models.CharField(
        max_length=16, choices=SessionPersonRole.choices, default=SessionPersonRole.SPEAKER,
    )
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        related_name="+", editable=False,
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        related_name="+", editable=False,
    )

    class Meta:
        ordering = ("sort_order", "role", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("session", "person", "role"),
                name="session_person_role_uniq",
            ),
        ]
        indexes = [
            models.Index(fields=("session", "sort_order"), name="session_person_order"),
            models.Index(fields=("person", "session"), name="session_person_lookup"),
        ]

    def __str__(self):
        return f"{self.person_id}:{self.role}"

    def clean(self):
        from apps.cms.event_person_domain import validate_assignment
        validate_assignment(self)

    def save(self, *args, **kwargs):
        from apps.organizations.hierarchy_lock import hierarchy_write
        from apps.audit.context import database_audit_context
        with hierarchy_write(), database_audit_context():
            self.full_clean()
            super().save(*args, **kwargs)
