"""Event registration records with capacity and waitlist status."""
from __future__ import annotations

import secrets
import uuid

from django.db import models
from django.utils import timezone


class RegistrationStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    CONFIRMED = "CONFIRMED", "Confirmed"
    WAITLISTED = "WAITLISTED", "Waitlisted"
    CANCELLED = "CANCELLED", "Cancelled"


class NotificationDeliveryStatus(models.TextChoices):
    NOT_CONFIGURED = "NOT_CONFIGURED", "Not configured"
    PENDING = "PENDING", "Pending"
    SENT = "SENT", "Sent"
    FAILED = "FAILED", "Failed"


ACTIVE_REGISTRATION_STATUSES = frozenset({
    RegistrationStatus.PENDING,
    RegistrationStatus.CONFIRMED,
    RegistrationStatus.WAITLISTED,
})


def new_management_token() -> str:
    return secrets.token_urlsafe(32)


class EventRegistration(models.Model):
    """One visitor registration scoped to a Site Event."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        "cms.Event", on_delete=models.CASCADE, related_name="registrations",
    )
    site = models.ForeignKey(
        "sites.Site", on_delete=models.PROTECT, related_name="event_registrations",
    )
    request_id = models.UUIDField()
    email = models.EmailField(max_length=254)
    email_normalized = models.EmailField(max_length=254, db_index=True)
    participant_name = models.CharField(max_length=200)
    organization = models.CharField(max_length=255, blank=True, default="")
    phone = models.CharField(max_length=64, blank=True, default="")
    status = models.CharField(
        max_length=12, choices=RegistrationStatus.choices, default=RegistrationStatus.PENDING,
    )
    consent_at = models.DateTimeField()
    consent_text = models.CharField(max_length=500, blank=True, default="")
    management_token = models.CharField(max_length=64, default=new_management_token, editable=False)
    waitlist_position = models.PositiveIntegerField(null=True, blank=True)
    notification_status = models.CharField(
        max_length=16,
        choices=NotificationDeliveryStatus.choices,
        default=NotificationDeliveryStatus.NOT_CONFIGURED,
    )
    notification_attempted_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("created_at", "id")
        indexes = [
            models.Index(fields=("event", "status", "created_at"), name="event_reg_status_idx"),
            models.Index(fields=("site", "-created_at"), name="event_reg_site_created_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=("event", "request_id"),
                name="event_reg_request_uniq",
            ),
            models.UniqueConstraint(
                fields=("event", "email_normalized"),
                condition=models.Q(status__in=["PENDING", "CONFIRMED", "WAITLISTED"]),
                name="event_reg_active_email_uniq",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=["PENDING", "CONFIRMED", "WAITLISTED", "CANCELLED"]),
                name="event_reg_status_valid",
            ),
        ]

    def __str__(self):
        return f"{self.email_normalized} ({self.status})"
