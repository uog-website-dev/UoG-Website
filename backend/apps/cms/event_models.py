"""Site-owned Event records with an explicit publication lifecycle."""
from __future__ import annotations

import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone
from django.utils.text import slugify


class EventStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    PUBLISHED = "PUBLISHED", "Published"
    CANCELLED = "CANCELLED", "Cancelled"
    ARCHIVED = "ARCHIVED", "Archived"


class EventFormat(models.TextChoices):
    PHYSICAL = "PHYSICAL", "Physical"
    ONLINE = "ONLINE", "Online"
    HYBRID = "HYBRID", "Hybrid"


class EventLifecycle(models.TextChoices):
    """Derived from current time and Event boundaries; never stored."""

    UPCOMING = "UPCOMING", "Upcoming"
    IN_PROGRESS = "IN_PROGRESS", "In progress"
    PAST = "PAST", "Past"
    UNKNOWN = "UNKNOWN", "Unknown"


class Event(models.Model):
    """One Site-owned Event. Ownership is immutable; statuses are explicit."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey(
        "sites.Site", on_delete=models.PROTECT, related_name="events",
    )
    title = models.CharField(max_length=255, blank=True, default="")
    slug = models.SlugField(max_length=255, blank=True, default="")
    summary = models.CharField(max_length=500, blank=True, default="")
    description = models.TextField(blank=True, default="")
    category = models.ForeignKey(
        "api.Category", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="events",
    )
    organizer_name = models.CharField(max_length=255, blank=True, default="")
    organizer_email = models.EmailField(blank=True, default="")
    organizer_phone = models.CharField(max_length=64, blank=True, default="")
    status = models.CharField(
        max_length=12, choices=EventStatus.choices, default=EventStatus.DRAFT,
    )
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    timezone = models.CharField(max_length=64, blank=True, default="")
    venue = models.CharField(max_length=255, blank=True, default="")
    format = models.CharField(
        max_length=12, choices=EventFormat.choices, default=EventFormat.PHYSICAL,
    )
    online_url = models.CharField(max_length=2048, blank=True, default="")
    banner_asset = models.ForeignKey(
        "media.MediaAsset", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="event_banners",
    )
    registration_required = models.BooleanField(default=False)
    registration_capacity = models.PositiveIntegerField(null=True, blank=True)
    registration_open = models.BooleanField(default=True)
    registration_opens_at = models.DateTimeField(null=True, blank=True)
    registration_closes_at = models.DateTimeField(null=True, blank=True)
    waitlist_enabled = models.BooleanField(default=False)
    registration_category = models.CharField(max_length=120, blank=True, default="")
    registration_required_fields = models.JSONField(default=list, blank=True)
    registration_notice = models.TextField(blank=True, default="")
    cancellation_notice = models.TextField(blank=True, default="")
    published_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
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
        ordering = ("-starts_at", "-updated_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("site", "slug"),
                condition=~models.Q(slug=""),
                name="event_site_slug_uniq",
            ),
        ]
        indexes = [
            models.Index(fields=("site", "status"), name="event_site_status"),
            models.Index(fields=("site", "starts_at"), name="event_site_starts"),
        ]

    def __str__(self):
        return self.title or str(self.pk)

    @classmethod
    def from_db(cls, db, field_names, values):
        instance = super().from_db(db, field_names, values)
        instance._original_site_id = instance.site_id
        return instance

    def clean(self):
        from apps.cms.event_domain import validate_event
        validate_event(self, require_publishable=False)

    def save(self, *args, **kwargs):
        from apps.organizations.hierarchy_lock import hierarchy_write
        from apps.audit.context import database_audit_context
        with hierarchy_write(), database_audit_context():
            if not self._state.adding and getattr(self, "_original_site_id", self.site_id) != self.site_id:
                raise ValidationError({"site": "Event ownership cannot be reassigned."})
            if not self.slug and self.title:
                self.slug = slugify(self.title)[:255]
            self.full_clean()
            super().save(*args, **kwargs)
            self.refresh_from_db(fields=["version"])

    def derived_lifecycle(self, *, now=None) -> str:
        now = now or timezone.now()
        if self.starts_at is None or self.ends_at is None:
            return EventLifecycle.UNKNOWN
        if now < self.starts_at:
            return EventLifecycle.UPCOMING
        if now > self.ends_at:
            return EventLifecycle.PAST
        return EventLifecycle.IN_PROGRESS

    @property
    def accepts_registration(self) -> bool:
        from apps.cms.event_registration_domain import event_accepts_registration
        return event_accepts_registration(self)
