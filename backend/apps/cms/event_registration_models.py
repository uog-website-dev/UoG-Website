"""Event registration / participant records with capacity and waitlist status."""
from __future__ import annotations

import secrets
import uuid

from django.db import models


class RegistrationStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    CONFIRMED = "CONFIRMED", "Confirmed"
    WAITLISTED = "WAITLISTED", "Waitlisted"
    CANCELLED = "CANCELLED", "Cancelled"
    INVITED = "INVITED", "Invited"


class ParticipantCategory(models.TextChoices):
    PARTICIPANT = "PARTICIPANT", "Participant"
    SPEAKER = "SPEAKER", "Speaker"
    VIP = "VIP", "VIP"
    MODERATOR = "MODERATOR", "Moderator"
    ORGANIZER = "ORGANIZER", "Organizer"


class RegistrationSource(models.TextChoices):
    PUBLIC = "PUBLIC", "Public"
    ADMIN_INVITE = "ADMIN_INVITE", "Admin invite"
    ADMIN_MANUAL = "ADMIN_MANUAL", "Admin manual"


class NotificationDeliveryStatus(models.TextChoices):
    NOT_CONFIGURED = "NOT_CONFIGURED", "Not configured"
    PENDING = "PENDING", "Pending"
    SENT = "SENT", "Sent"
    FAILED = "FAILED", "Failed"


ACTIVE_REGISTRATION_STATUSES = frozenset({
    RegistrationStatus.PENDING,
    RegistrationStatus.CONFIRMED,
    RegistrationStatus.WAITLISTED,
    RegistrationStatus.INVITED,
})

# Seats consumed by confirmed/pending/invited; waitlisted do not consume capacity.
SEAT_HOLDING_STATUSES = frozenset({
    RegistrationStatus.PENDING,
    RegistrationStatus.CONFIRMED,
    RegistrationStatus.INVITED,
})

CSV_EXPORT_FIELDS = (
    "id",
    "participant_name",
    "email",
    "organization",
    "status",
    "display_category",
    "source",
    "waitlist_position",
    "created_at",
    "confirmed_at",
    "cancelled_at",
)

BADGE_PUBLIC_FIELDS = (
    "event_title",
    "participant_name",
    "display_category",
    "check_in_token",
)


def new_management_token() -> str:
    return secrets.token_urlsafe(32)


def new_check_in_token() -> str:
    return secrets.token_urlsafe(16)


class EventRegistration(models.Model):
    """One visitor/participant registration scoped to a Site Event."""

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
    display_category = models.CharField(
        max_length=16,
        choices=ParticipantCategory.choices,
        default=ParticipantCategory.PARTICIPANT,
    )
    source = models.CharField(
        max_length=16,
        choices=RegistrationSource.choices,
        default=RegistrationSource.PUBLIC,
    )
    consent_at = models.DateTimeField(null=True, blank=True)
    consent_text = models.CharField(max_length=500, blank=True, default="")
    management_token = models.CharField(max_length=64, default=new_management_token, editable=False)
    check_in_token = models.CharField(max_length=64, default=new_check_in_token, editable=False)
    waitlist_position = models.PositiveIntegerField(null=True, blank=True)
    notification_status = models.CharField(
        max_length=16,
        choices=NotificationDeliveryStatus.choices,
        default=NotificationDeliveryStatus.NOT_CONFIGURED,
    )
    notification_attempted_at = models.DateTimeField(null=True, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("created_at", "id")
        indexes = [
            models.Index(fields=("event", "status", "created_at"), name="event_reg_status_idx"),
            models.Index(fields=("site", "-created_at"), name="event_reg_site_created_idx"),
            models.Index(fields=("event", "display_category"), name="event_reg_category_idx"),
            models.Index(fields=("event", "check_in_token"), name="event_reg_checkin_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=("event", "request_id"),
                name="event_reg_request_uniq",
            ),
            models.UniqueConstraint(
                fields=("event", "email_normalized"),
                condition=models.Q(
                    status__in=["PENDING", "CONFIRMED", "WAITLISTED", "INVITED"],
                    deleted_at__isnull=True,
                ),
                name="event_reg_active_email_uniq",
            ),
            models.UniqueConstraint(
                fields=("event", "check_in_token"),
                name="event_reg_checkin_uniq",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    status__in=["PENDING", "CONFIRMED", "WAITLISTED", "CANCELLED", "INVITED"]
                ),
                name="event_reg_status_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    display_category__in=["PARTICIPANT", "SPEAKER", "VIP", "MODERATOR", "ORGANIZER"]
                ),
                name="event_reg_category_valid",
            ),
        ]

    def __str__(self):
        return f"{self.email_normalized} ({self.status})"
