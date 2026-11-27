"""Atomic Event registration, waitlist promotion, participants and public-safe state."""
from __future__ import annotations

import csv
import io
import re
from typing import Any
from uuid import UUID, uuid4

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
    BADGE_PUBLIC_FIELDS,
    CSV_EXPORT_FIELDS,
    EventRegistration,
    NotificationDeliveryStatus,
    ParticipantCategory,
    RegistrationSource,
    RegistrationStatus,
    SEAT_HOLDING_STATUSES,
    new_management_token,
)
from apps.organizations.hierarchy_lock import hierarchy_write

ALLOWED_REQUIRED_FIELDS = frozenset({"participant_name", "email", "organization", "phone"})
DEFAULT_REQUIRED_FIELDS = ["participant_name", "email"]
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


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


def neutralize_csv_cell(value: Any) -> str:
    """Prefix spreadsheet formula injection vectors with a single quote."""
    text = "" if value is None else str(value)
    if text and text[0] in FORMULA_PREFIXES:
        return f"'{text}"
    return text


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
    ordered = [code for code in ["participant_name", "email", "organization", "phone"] if code in fields]
    return ordered


def registration_window_open(event: Event, *, now=None) -> bool:
    now = now or timezone.now()
    if event.registration_opens_at and now < event.registration_opens_at:
        return False
    if event.registration_closes_at and now > event.registration_closes_at:
        return False
    return True


def _alive_qs(event_id=None):
    qs = EventRegistration.objects.filter(deleted_at__isnull=True)
    if event_id is not None:
        qs = qs.filter(event_id=event_id)
    return qs


def confirmed_count(event: Event) -> int:
    return _alive_qs(event.pk).filter(status__in=list(SEAT_HOLDING_STATUSES)).count()


def waitlisted_count(event: Event) -> int:
    return _alive_qs(event.pk).filter(status=RegistrationStatus.WAITLISTED).count()


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
        _alive_qs(event.pk)
        .filter(status=RegistrationStatus.WAITLISTED)
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


def _audit(action: str, row: EventRegistration, after: dict, changed_fields: list[str]):
    context = current_audit_context()
    with audit_context(
        actor_kind=getattr(context, "actor_kind", None) or "SYSTEM",
        actor_id=getattr(context, "actor_id", None) or "event-registration",
        request_id=getattr(context, "request_id", None),
    ):
        record_event(
            action=action,
            entity_type="cms.event_registration",
            entity_id=row.pk,
            after=after,
            changed_fields=changed_fields,
        )


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

        existing_request = _alive_qs(locked.pk).filter(request_id=request_uuid).first()
        if existing_request:
            return existing_request

        if _alive_qs(locked.pk).filter(
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

        now = timezone.now()
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
            display_category=ParticipantCategory.PARTICIPANT,
            source=RegistrationSource.PUBLIC,
            consent_at=now,
            consent_text=consent_text or "I agree to be contacted about this Event.",
            management_token=new_management_token(),
            waitlist_position=waitlist_position,
            confirmed_at=now if status == RegistrationStatus.CONFIRMED else None,
        )
        _attempt_notification(row)
        row.save()
        _audit(
            "EVENT_REGISTRATION_CREATED",
            row,
            {"status": row.status, "event": str(locked.pk), "source": row.source},
            ["status"],
        )
        return row


def admin_create_participant(event: Event, payload: dict[str, Any]) -> EventRegistration:
    """Site Admin invite or manual registration. Does not create a CMS account."""
    email = normalize_email(payload.get("email", ""))
    name = sanitize_plain(payload.get("participant_name", ""), max_length=200)
    organization = sanitize_plain(payload.get("organization", ""), max_length=255)
    phone = sanitize_plain(payload.get("phone", ""), max_length=64)
    category = str(payload.get("display_category") or ParticipantCategory.PARTICIPANT).upper()
    mode = str(payload.get("mode") or "invite").strip().lower()
    request_id = payload.get("request_id") or uuid4()

    errors: dict[str, list[str]] = {}
    if not name:
        errors["participant_name"] = ["Enter the participant name."]
    if not email or not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        errors["email"] = ["Enter a valid email address."]
    if category not in ParticipantCategory.values:
        errors["display_category"] = ["Choose a valid display category."]
    if mode not in {"invite", "register"}:
        errors["mode"] = ["Mode must be invite or register."]
    try:
        request_uuid = request_id if isinstance(request_id, UUID) else UUID(str(request_id))
    except (TypeError, ValueError, AttributeError):
        errors["request_id"] = ["Provide a valid request id."]
        request_uuid = None
    if errors:
        raise ValidationError(errors)

    with hierarchy_write(), transaction.atomic():
        locked = _lock_event(event.pk)
        existing_request = _alive_qs(locked.pk).filter(request_id=request_uuid).first()
        if existing_request:
            return existing_request

        if _alive_qs(locked.pk).filter(
            email_normalized=email,
            status__in=list(ACTIVE_REGISTRATION_STATUSES),
        ).exists():
            raise RegistrationDuplicate("An active registration already exists for this email.")

        remaining = seats_remaining(locked)
        now = timezone.now()
        if mode == "invite":
            if remaining is not None and remaining <= 0 and not locked.waitlist_enabled:
                raise RegistrationFull("This Event is full.")
            if remaining is not None and remaining <= 0 and locked.waitlist_enabled:
                status = RegistrationStatus.WAITLISTED
                waitlist_position = _next_waitlist_position(locked)
                source = RegistrationSource.ADMIN_INVITE
            else:
                status = RegistrationStatus.INVITED
                waitlist_position = None
                source = RegistrationSource.ADMIN_INVITE
            confirmed_at = None
        else:
            if remaining is None or remaining > 0:
                status = RegistrationStatus.CONFIRMED
                waitlist_position = None
                confirmed_at = now
            elif locked.waitlist_enabled:
                status = RegistrationStatus.WAITLISTED
                waitlist_position = _next_waitlist_position(locked)
                confirmed_at = None
            else:
                raise RegistrationFull("This Event is full.")
            source = RegistrationSource.ADMIN_MANUAL

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
            display_category=category,
            source=source,
            consent_at=now,
            consent_text="Added by Site Administrator.",
            management_token=new_management_token(),
            waitlist_position=waitlist_position,
            confirmed_at=confirmed_at,
        )
        _attempt_notification(row)
        row.save()
        _audit(
            "EVENT_PARTICIPANT_ADMIN_CREATED",
            row,
            {
                "status": row.status,
                "source": row.source,
                "display_category": row.display_category,
                "event": str(locked.pk),
            },
            ["status", "display_category", "source"],
        )
        return row


def admin_update_participant(event: Event, registration_id, payload: dict[str, Any]) -> EventRegistration:
    """Update display category / contact fields without touching session speaker roles."""
    with hierarchy_write(), transaction.atomic():
        locked = _lock_event(event.pk)
        row = (
            _alive_qs(locked.pk)
            .select_for_update()
            .filter(pk=registration_id)
            .first()
        )
        if row is None:
            raise RegistrationNotFound("Participant was not found.")

        changed: list[str] = []
        if "participant_name" in payload:
            name = sanitize_plain(payload.get("participant_name", ""), max_length=200)
            if not name:
                raise ValidationError({"participant_name": ["Enter the participant name."]})
            row.participant_name = name
            changed.append("participant_name")
        if "organization" in payload:
            row.organization = sanitize_plain(payload.get("organization", ""), max_length=255)
            changed.append("organization")
        if "phone" in payload:
            row.phone = sanitize_plain(payload.get("phone", ""), max_length=64)
            changed.append("phone")
        if "display_category" in payload:
            category = str(payload.get("display_category") or "").upper()
            if category not in ParticipantCategory.values:
                raise ValidationError({"display_category": ["Choose a valid display category."]})
            row.display_category = category
            changed.append("display_category")
        if not changed:
            return row
        row.save(update_fields=[*changed, "updated_at"])
        _audit(
            "EVENT_PARTICIPANT_UPDATED",
            row,
            {field: getattr(row, field) for field in changed},
            changed,
        )
        return row


def admin_set_status(event: Event, registration_id, *, action: str) -> EventRegistration:
    """Confirm, cancel, or soft-delete a participant via the shared registration service."""
    action = (action or "").strip().lower()
    if action not in {"confirm", "cancel", "delete"}:
        raise ValidationError({"action": ["Action must be confirm, cancel, or delete."]})

    with hierarchy_write(), transaction.atomic():
        locked = _lock_event(event.pk)
        row = (
            _alive_qs(locked.pk)
            .select_for_update()
            .filter(pk=registration_id)
            .first()
        )
        if row is None:
            raise RegistrationNotFound("Participant was not found.")

        now = timezone.now()
        promoted = None
        if action == "confirm":
            if row.status == RegistrationStatus.CONFIRMED:
                return row
            remaining = seats_remaining(locked)
            # Confirming a seat-holding INVITED/PENDING does not consume an extra seat.
            occupies = row.status in SEAT_HOLDING_STATUSES
            if not occupies and remaining is not None and remaining <= 0:
                raise RegistrationFull("This Event is full.")
            row.status = RegistrationStatus.CONFIRMED
            row.confirmed_at = now
            row.cancelled_at = None
            row.waitlist_position = None
            row.save(update_fields=[
                "status", "confirmed_at", "cancelled_at", "waitlist_position", "updated_at",
            ])
            audit_action = "EVENT_PARTICIPANT_CONFIRMED"
        elif action == "cancel":
            if row.status == RegistrationStatus.CANCELLED:
                return row
            row.status = RegistrationStatus.CANCELLED
            row.cancelled_at = now
            row.waitlist_position = None
            row.save(update_fields=["status", "cancelled_at", "waitlist_position", "updated_at"])
            promoted = _promote_waitlist(locked)
            audit_action = "EVENT_PARTICIPANT_CANCELLED"
        else:
            row.status = RegistrationStatus.CANCELLED
            row.cancelled_at = row.cancelled_at or now
            row.deleted_at = now
            row.waitlist_position = None
            row.save(update_fields=[
                "status", "cancelled_at", "deleted_at", "waitlist_position", "updated_at",
            ])
            promoted = _promote_waitlist(locked)
            audit_action = "EVENT_PARTICIPANT_SOFT_DELETED"

        _audit(
            audit_action,
            row,
            {
                "status": row.status,
                "deleted_at": str(row.deleted_at) if row.deleted_at else None,
                "promoted": str(promoted.pk) if promoted else None,
            },
            ["status"],
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
            _alive_qs(locked.pk)
            .select_for_update()
            .filter(
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
        _audit(
            "EVENT_REGISTRATION_CANCELLED",
            row,
            {"status": row.status, "promoted": str(promoted.pk) if promoted else None},
            ["status"],
        )
        return row


def _promote_waitlist(event: Event) -> EventRegistration | None:
    """Promote the oldest waitlisted registration when a confirmed seat frees."""
    remaining = seats_remaining(event)
    if remaining is not None and remaining <= 0:
        return None
    candidate = (
        _alive_qs(event.pk)
        .select_for_update()
        .filter(status=RegistrationStatus.WAITLISTED)
        .order_by("waitlist_position", "created_at", "id")
        .first()
    )
    if candidate is None:
        return None
    remaining = seats_remaining(event)
    if remaining is not None and remaining <= 0:
        return None
    candidate.status = RegistrationStatus.CONFIRMED
    candidate.confirmed_at = timezone.now()
    candidate.waitlist_position = None
    _attempt_notification(candidate)
    candidate.save(update_fields=[
        "status", "confirmed_at", "waitlist_position", "notification_status",
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
        "display_category": row.display_category,
        "source": row.source,
        "consent_at": row.consent_at,
        "waitlist_position": row.waitlist_position,
        "notification_status": row.notification_status,
        "check_in_token": row.check_in_token,
        "confirmed_at": row.confirmed_at,
        "cancelled_at": row.cancelled_at,
        "deleted_at": row.deleted_at,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def serialize_badge(event: Event, row: EventRegistration) -> dict[str, Any]:
    """Printable badge payload — no private contact fields."""
    return {
        "event_title": event.title,
        "participant_name": row.participant_name,
        "display_category": row.display_category,
        "check_in_token": row.check_in_token,
        "fields": list(BADGE_PUBLIC_FIELDS),
    }


def registration_summary(event: Event) -> dict[str, Any]:
    counts = _alive_qs(event.pk).aggregate(
        confirmed=Count("id", filter=Q(status__in=list(SEAT_HOLDING_STATUSES))),
        waitlisted=Count("id", filter=Q(status=RegistrationStatus.WAITLISTED)),
        cancelled=Count("id", filter=Q(status=RegistrationStatus.CANCELLED)),
        invited=Count("id", filter=Q(status=RegistrationStatus.INVITED)),
    )
    return {
        "confirmed": counts["confirmed"] or 0,
        "waitlisted": counts["waitlisted"] or 0,
        "cancelled": counts["cancelled"] or 0,
        "invited": counts["invited"] or 0,
        "capacity": event.registration_capacity,
        "seats_remaining": seats_remaining(event),
        "state": public_registration_state(event),
    }


def list_participants(
    event: Event,
    *,
    status: str = "",
    category: str = "",
    search: str = "",
    page: int = 1,
    page_size: int = 25,
    include_deleted: bool = False,
) -> dict[str, Any]:
    qs = EventRegistration.objects.filter(event_id=event.pk)
    if not include_deleted:
        qs = qs.filter(deleted_at__isnull=True)
    if status:
        qs = qs.filter(status=status.upper())
    if category:
        qs = qs.filter(display_category=category.upper())
    search = (search or "").strip()
    if search:
        qs = qs.filter(
            Q(participant_name__icontains=search)
            | Q(email__icontains=search)
            | Q(organization__icontains=search)
        )
    qs = qs.order_by("created_at", "id")
    page = max(1, int(page or 1))
    page_size = min(100, max(1, int(page_size or 25)))
    total = qs.count()
    start = (page - 1) * page_size
    rows = list(qs[start:start + page_size])
    return {
        "summary": registration_summary(event),
        "count": total,
        "page": page,
        "page_size": page_size,
        "results": [serialize_registration(row, public=False) for row in rows],
    }


def build_participants_csv(event: Event) -> tuple[str, bytes]:
    """CSV of authorized fields only, with formula-injection neutralization."""
    rows = _alive_qs(event.pk).order_by("created_at", "id")
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(CSV_EXPORT_FIELDS)
    for row in rows:
        writer.writerow([
            neutralize_csv_cell(getattr(row, field))
            for field in CSV_EXPORT_FIELDS
        ])
    content = buffer.getvalue().encode("utf-8-sig")
    filename = f"event-{event.slug}-participants.csv"
    return filename, content
