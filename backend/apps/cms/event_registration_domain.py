"""Atomic Event registration, waitlist promotion and public-safe state."""
from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from django.utils.html import strip_tags

from apps.audit.context import audit_context, current_audit_context
from apps.audit.writer import record_event
from apps.cms.event_models import Event, EventLifecycle, EventStatus
from apps.cms.event_registration_models import (
    ACTIVE_REGISTRATION_STATUSES,
    EventRegistration,
    NotificationDeliveryStatus,
    RegistrationStatus,
    new_management_token,
)
from apps.organizations.hierarchy_lock import hierarchy_write

ALLOWED_REQUIRED_FIELDS = frozenset({"participant_name", "email", "organization", "phone"})
DEFAULT_REQUIRED_FIELDS = ["participant_name", "email"]


class RegistrationClosed(Exception):
    """Registration is not accepting submissions."""


class RegistrationFull(Exception):
    """Capacity exhausted and waitlist is unavailable."""


class RegistrationDuplicate(Exception):
    """An active registration already exists for this email."""


class RegistrationNotFound(Exception):
    """Cancel/lookup token does not match an active registration."""


def normalize_email(value: str) -> str:
    return (value or "").strip().lower()


def sanitize_plain(value: str, *, max_length: int) -> str:
    text = strip_tags(value or "").replace("\x00", "").strip()
    return text[:max_length]


def normalize_required_fields(value) -> list[str]:
    if value in (None, ""):
        return list(DEFAULT_REQUIRED_FIELDS)
    if not isinstance(value, list):
        raise ValidationError({"registration_required_fields": ["Provide a list of field codes."]})
    fields = []
    for item in value:
        code = str(item or "").strip()
        if code not in ALLOWED_REQUIRED_FIELDS:
            raise ValidationError({
                "registration_required_fields": [f"Unsupported field '{code}'."],
            })
        if code not in fields:
            fields.append(code)
    for required in DEFAULT_REQUIRED_FIELDS:
        if required not in fields:
            fields.insert(0 if required == "participant_name" else len(fields), required)
    # Keep stable order: name, email, then extras.
    ordered = [code for code in ["participant_name", "email", "organization", "phone"] if code in fields]
    return ordered


def registration_window_open(event: Event, *, now=None) -> bool:
    now = now or timezone.now()
    if event.registration_opens_at and now < event.registration_opens_at:
        return False
    if event.registration_closes_at and now > event.registration_closes_at:
        return False
    return True


def confirmed_count(event: Event) -> int:
    return EventRegistration.objects.filter(
        event_id=event.pk,
        status__in=[RegistrationStatus.CONFIRMED, RegistrationStatus.PENDING],
    ).count()


def waitlisted_count(event: Event) -> int:
    return EventRegistration.objects.filter(
        event_id=event.pk, status=RegistrationStatus.WAITLISTED,
    ).count()


def seats_remaining(event: Event) -> int | None:
    if event.registration_capacity is None:
        return None
    remaining = event.registration_capacity - confirmed_count(event)
    return max(0, remaining)


def public_registration_state(event: Event, *, now=None) -> str:
    """Aggregate-only registration state for public cards/detail."""
    now = now or timezone.now()
    if (
        not event.registration_required
        or event.status != EventStatus.PUBLISHED
        or not event.registration_open
        or event.derived_lifecycle(now=now) == EventLifecycle.PAST
        or not registration_window_open(event, now=now)
    ):
        if not event.registration_required:
            return "OFF"
        return "CLOSED"
    remaining = seats_remaining(event)
    if remaining is None or remaining > 0:
        return "OPEN"
    if event.waitlist_enabled:
        return "WAITLIST_AVAILABLE"
    return "FULL"


def event_accepts_registration(event: Event, *, now=None) -> bool:
    state = public_registration_state(event, now=now)
    return state in {"OPEN", "WAITLIST_AVAILABLE"}


def _lock_event(event_id) -> Event:
    return Event.objects.select_for_update().select_related("site").get(pk=event_id)


def _next_waitlist_position(event: Event) -> int:
    latest = (
        EventRegistration.objects.filter(event_id=event.pk, status=RegistrationStatus.WAITLISTED)
        .order_by("-waitlist_position", "-created_at")
        .values_list("waitlist_position", flat=True)
        .first()
    )
    return int(latest or 0) + 1


def _attempt_notification(registration: EventRegistration) -> None:
    """Optional outbound notice. Never fabricates a successful delivery."""
    configured = bool(getattr(settings, "EVENT_REGISTRATION_NOTIFY_ENABLED", False))
    registration.notification_attempted_at = timezone.now()
    if not configured:
        registration.notification_status = NotificationDeliveryStatus.NOT_CONFIGURED
        return
    sender = getattr(settings, "EVENT_REGISTRATION_NOTIFY_BACKEND", None)
    if not callable(sender):
        registration.notification_status = NotificationDeliveryStatus.NOT_CONFIGURED
        return
    registration.notification_status = NotificationDeliveryStatus.PENDING
    try:
        sender(registration)
        registration.notification_status = NotificationDeliveryStatus.SENT
    except Exception:
        registration.notification_status = NotificationDeliveryStatus.FAILED


def create_registration(event: Event, payload: dict[str, Any], *, website: str = "") -> EventRegistration:
    """Create a registration under Event row lock. website is a honeypot."""
    if (website or "").strip():
        raise ValidationError({"website": ["Leave this field blank."]})

    email = normalize_email(payload.get("email", ""))
    name = sanitize_plain(payload.get("participant_name", ""), max_length=200)
    organization = sanitize_plain(payload.get("organization", ""), max_length=255)
    phone = sanitize_plain(payload.get("phone", ""), max_length=64)
    consent = bool(payload.get("consent"))
    consent_text = sanitize_plain(payload.get("consent_text", ""), max_length=500)
    request_id = payload.get("request_id")

    required = normalize_required_fields(event.registration_required_fields)
    errors: dict[str, list[str]] = {}
    if "participant_name" in required and not name:
        errors["participant_name"] = ["Enter your name."]
    if "email" in required:
        if not email or not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            errors["email"] = ["Enter a valid email address."]
    if "organization" in required and not organization:
        errors["organization"] = ["Enter your organization."]
    if "phone" in required and not phone:
        errors["phone"] = ["Enter a phone number."]
    if not consent:
        errors["consent"] = ["Consent is required to register."]
    try:
        request_uuid = request_id if isinstance(request_id, UUID) else UUID(str(request_id))
    except (TypeError, ValueError, AttributeError):
        errors["request_id"] = ["Provide a registration request id."]
        request_uuid = None
    if errors:
        raise ValidationError(errors)

    with hierarchy_write(), transaction.atomic():
        locked = _lock_event(event.pk)
        if not event_accepts_registration(locked):
            raise RegistrationClosed("Registration is not open for this Event.")

        existing_request = EventRegistration.objects.filter(event_id=locked.pk, request_id=request_uuid).first()
        if existing_request:
            return existing_request

        if EventRegistration.objects.filter(
            event_id=locked.pk,
            email_normalized=email,
            status__in=list(ACTIVE_REGISTRATION_STATUSES),
        ).exists():
            raise RegistrationDuplicate("An active registration already exists for this email.")

        remaining = seats_remaining(locked)
        if remaining is None or remaining > 0:
            status = RegistrationStatus.CONFIRMED
            waitlist_position = None
        elif locked.waitlist_enabled:
            status = RegistrationStatus.WAITLISTED
            waitlist_position = _next_waitlist_position(locked)
        else:
            raise RegistrationFull("This Event is full.")

        row = EventRegistration(
            event=locked,
            site_id=locked.site_id,
            request_id=request_uuid,
            email=email,
            email_normalized=email,
            participant_name=name,
            organization=organization,
            phone=phone,
            status=status,
            consent_at=timezone.now(),
            consent_text=consent_text or "I agree to be contacted about this Event.",
            management_token=new_management_token(),
            waitlist_position=waitlist_position,
        )
        _attempt_notification(row)
        row.save()
        context = current_audit_context()
        with audit_context(
            actor_kind="SYSTEM",
            actor_id="event-registration",
            request_id=getattr(context, "request_id", None),
        ):
            record_event(
                action="EVENT_REGISTRATION_CREATED",
                entity_type="cms.event_registration",
                entity_id=row.pk,
                after={"status": row.status, "event": str(locked.pk)},
                changed_fields=["status"],
            )
        return row


def cancel_registration(*, event: Event, email: str, token: str) -> EventRegistration:
    email_norm = normalize_email(email)
    token = (token or "").strip()
    if not email_norm or not token:
        raise RegistrationNotFound("Registration was not found.")

    with hierarchy_write(), transaction.atomic():
        locked = _lock_event(event.pk)
        row = (
            EventRegistration.objects.select_for_update()
            .filter(
                event_id=locked.pk,
                email_normalized=email_norm,
                management_token=token,
                status__in=list(ACTIVE_REGISTRATION_STATUSES),
            )
            .first()
        )
        if row is None:
            raise RegistrationNotFound("Registration was not found.")
        row.status = RegistrationStatus.CANCELLED
        row.cancelled_at = timezone.now()
        row.waitlist_position = None
        row.save(update_fields=["status", "cancelled_at", "waitlist_position", "updated_at"])
        promoted = _promote_waitlist(locked)
        context = current_audit_context()
        with audit_context(
            actor_kind="SYSTEM",
            actor_id="event-registration",
            request_id=getattr(context, "request_id", None),
        ):
            record_event(
                action="EVENT_REGISTRATION_CANCELLED",
                entity_type="cms.event_registration",
                entity_id=row.pk,
                after={"status": row.status, "promoted": str(promoted.pk) if promoted else None},
                changed_fields=["status"],
            )
        return row


def _promote_waitlist(event: Event) -> EventRegistration | None:
    """Promote the oldest waitlisted registration when a confirmed seat frees."""
    remaining = seats_remaining(event)
    if remaining is not None and remaining <= 0:
        return None
    if remaining is None and not event.registration_capacity:
        # Unlimited capacity: still promote waitlisted when capacity was previously constrained.
        pass
    candidate = (
        EventRegistration.objects.select_for_update()
        .filter(event_id=event.pk, status=RegistrationStatus.WAITLISTED)
        .order_by("waitlist_position", "created_at", "id")
        .first()
    )
    if candidate is None:
        return None
    # Re-check after lock: capacity may have filled.
    remaining = seats_remaining(event)
    if remaining is not None and remaining <= 0:
        return None
    candidate.status = RegistrationStatus.CONFIRMED
    candidate.waitlist_position = None
    _attempt_notification(candidate)
    candidate.save(update_fields=[
        "status", "waitlist_position", "notification_status",
        "notification_attempted_at", "updated_at",
    ])
    return candidate


def serialize_registration(row: EventRegistration, *, public: bool = False) -> dict[str, Any]:
    if public:
        return {
            "id": row.pk,
            "status": row.status,
            "management_token": row.management_token,
            "waitlist_position": row.waitlist_position,
            "notification_status": row.notification_status,
        }
    return {
        "id": row.pk,
        "event": row.event_id,
        "site": row.site_id,
        "email": row.email,
        "participant_name": row.participant_name,
        "organization": row.organization,
        "phone": row.phone,
        "status": row.status,
        "consent_at": row.consent_at,
        "waitlist_position": row.waitlist_position,
        "notification_status": row.notification_status,
        "cancelled_at": row.cancelled_at,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def registration_summary(event: Event) -> dict[str, Any]:
    counts = EventRegistration.objects.filter(event_id=event.pk).aggregate(
        confirmed=Count("id", filter=Q(status__in=[RegistrationStatus.CONFIRMED, RegistrationStatus.PENDING])),
        waitlisted=Count("id", filter=Q(status=RegistrationStatus.WAITLISTED)),
        cancelled=Count("id", filter=Q(status=RegistrationStatus.CANCELLED)),
    )
    return {
        "confirmed": counts["confirmed"] or 0,
        "waitlisted": counts["waitlisted"] or 0,
        "cancelled": counts["cancelled"] or 0,
        "capacity": event.registration_capacity,
        "seats_remaining": seats_remaining(event),
        "state": public_registration_state(event),
    }
