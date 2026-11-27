"""Event gallery associations to Site-owned Media images."""
from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class EventGalleryImage(models.Model):
    """Association to a Site MediaAsset; does not store image bytes."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        "cms.Event", on_delete=models.CASCADE, related_name="gallery_images",
    )
    site = models.ForeignKey(
        "sites.Site", on_delete=models.PROTECT, related_name="event_gallery_images",
    )
    media_asset = models.ForeignKey(
        "media.MediaAsset",
        on_delete=models.PROTECT,
        related_name="event_gallery_images",
    )
    session = models.ForeignKey(
        "cms.EventSession",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="gallery_images",
    )
    caption = models.CharField(max_length=500, blank=True, default="")
    alt_text = models.CharField(max_length=255, blank=True, default="")
    sort_order = models.PositiveIntegerField(default=0)
    is_published = models.BooleanField(default=False)
    usage_consent = models.BooleanField(default=False)
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
            models.Index(fields=("event", "is_published", "sort_order"), name="event_gal_pub_sort_idx"),
            models.Index(fields=("site", "-created_at"), name="event_gal_site_created_idx"),
            models.Index(fields=("event", "session", "sort_order"), name="event_gal_session_sort_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=("event", "media_asset"),
                condition=models.Q(removed_at__isnull=True),
                name="event_gal_active_asset_uniq",
            ),
        ]

    def __str__(self):
        return f"Gallery image {self.pk} ({'published' if self.is_published else 'draft'})"
