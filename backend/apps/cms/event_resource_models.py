"""Event ↔ Document associations for brochures, slides and session materials."""
from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class ResourceVisibility(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    PUBLIC = "PUBLIC", "Public"
    REGISTERED_ONLY = "REGISTERED_ONLY", "Registered only"


class ResourceCategory(models.TextChoices):
    BROCHURE = "BROCHURE", "Brochure"
    SLIDES = "SLIDES", "Slides"
    AGENDA = "AGENDA", "Agenda"
    HANDOUT = "HANDOUT", "Handout"
    OTHER = "OTHER", "Other"


class EventResource(models.Model):
    """Association to a Site-owned Document; does not store file bytes."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        "cms.Event", on_delete=models.CASCADE, related_name="resources",
    )
    site = models.ForeignKey(
        "sites.Site", on_delete=models.PROTECT, related_name="event_resources",
    )
    session = models.ForeignKey(
        "cms.EventSession",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="resources",
    )
    document = models.ForeignKey(
        "cms.Document",
        on_delete=models.PROTECT,
        related_name="event_resources",
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    category = models.CharField(
        max_length=16,
        choices=ResourceCategory.choices,
        default=ResourceCategory.OTHER,
    )
    sort_order = models.PositiveIntegerField(default=0)
    visibility = models.CharField(
        max_length=16,
        choices=ResourceVisibility.choices,
        default=ResourceVisibility.DRAFT,
    )
    published_at = models.DateTimeField(null=True, blank=True)
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
        ordering = ("sort_order", "created_at", "id")
        indexes = [
            models.Index(fields=("event", "visibility", "sort_order"), name="event_res_vis_sort_idx"),
            models.Index(fields=("site", "-created_at"), name="event_res_site_created_idx"),
            models.Index(fields=("event", "session", "sort_order"), name="event_res_session_sort_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(visibility__in=["DRAFT", "PUBLIC", "REGISTERED_ONLY"]),
                name="event_res_visibility_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    category__in=["BROCHURE", "SLIDES", "AGENDA", "HANDOUT", "OTHER"]
                ),
                name="event_res_category_valid",
            ),
            models.UniqueConstraint(
                fields=("event", "document"),
                condition=models.Q(removed_at__isnull=True),
                name="event_res_active_document_uniq",
            ),
        ]

    def __str__(self):
        return f"{self.title} ({self.visibility})"
