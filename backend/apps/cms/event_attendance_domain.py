"""Check-in, reports, and privacy-controlled attendance CSV exports."""
from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Any
from uuid import UUID

from django.core.exceptions import ValidationError
from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone

from apps.audit.writer import record_event
from apps.cms.event_attendance_models import AttendanceMethod, EventAttendance
from apps.cms.event_models import Event
from apps.cms.event_registration_domain import (
    neutralize_csv_cell,
    registration_summary,
)
from apps.cms.event_registration_models import (
    EventRegistration,
    RegistrationStatus,
)
from apps.organizations.hierarchy_lock import hierarchy_write

CHECKIN_SIGN_SALT = "cms.event-checkin"
CHECKIN_MAX_AGE = None  # Badge tokens do not expire with Event duration by default.
ELIGIBLE_WITHOUT_OVERRIDE = frozenset({
    RegistrationStatus.CONFIRMED,
    RegistrationStatus.INVITED,
})
REPORT_CSV_FIELDS = (
    "registration_id",
    "participant_name",
    "email",
    "organization",
    "status",
    "display_category",
    "attended",
    "checked_in_at",
    "checked_out_at",
    "method",
)


class AttendanceConflict(Exception):
    pass


class AttendanceNotFound(Exception):
    pass


class AttendanceForbidden(Exception):
    pass


def _signer() -> TimestampSigner:
    return TimestampSigner(salt=CHECKIN_SIGN_SALT)


def badge_qr_payload(event: Event, row: EventRegistration) -> str:
    """Opaque signed QR body binding Event identity to the check-in token."""
    return _signer().sign_object({
        "e": str(event.pk),
        "t": row.check_in_token,
    })


def parse_check_in_credential(raw: str, *, event: Event) -> str:
    """Return the registration check_in_token after Event binding checks."""
    value = (raw or "").strip()
    if not value:
        raise ValidationError({"token": ["Provide a check-in token or QR payload."]})
    # Prefer signed QR payloads; fall back to opaque badge token for manual scanners.
    try:
        payload = _signer().unsign_object(value, max_age=CHECKIN_MAX_AGE)
    except (BadSignature, SignatureExpired, ValueError, TypeError):
        return value
    if not isinstance(payload, dict):
        raise ValidationError({"token": ["QR payload is invalid."]})
    if str(payload.get("e") or "") != str(event.pk):
        raise ValidationError({"token": ["This badge belongs to a different Event."]})
    token = str(payload.get("t") or "").strip()
    if not token:
        raise ValidationError({"token": ["QR payload is missing a check-in token."]})
    return token


def serialize_attendance(row: EventAttendance) -> dict[str, Any]:
    return {
        "id": row.pk,
        "event": row.event_id,
        "registration": row.registration_id,
        "checked_in_at": row.checked_in_at,
        "checked_out_at": row.checked_out_at,
        "method": row.method,
        "operator": row.operator_id,
        "notes": row.notes,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "replayed": False,
    }


def _alive_registrations(event: Event):
    return EventRegistration.objects.filter(event_id=event.pk, deleted_at__isnull=True)


def _assert_check_in_allowed(registration: EventRegistration, *, override: bool) -> str:
    if registration.deleted_at is not None:
        raise AttendanceNotFound("Participant was not found.")
    if registration.status in ELIGIBLE_WITHOUT_OVERRIDE:
        return AttendanceMethod.MANUAL if not override else AttendanceMethod.OVERRIDE
    if registration.status == RegistrationStatus.CANCELLED:
        if not override:
            raise AttendanceForbidden(
                "Cancelled participants cannot be checked in without an authorized override."
            )
        return AttendanceMethod.OVERRIDE
    raise AttendanceForbidden(
        f"Participants with status {registration.status} cannot be checked in."
    )


def check_in_registration(
    event: Event,
    registration_id,
    *,
    actor,
    method: str = AttendanceMethod.MANUAL,
    override: bool = False,
    notes: str = "",
) -> tuple[EventAttendance, bool]:
    """Idempotent check-in. Returns (attendance, created)."""
    with hierarchy_write(), transaction.atomic():
        registration = (
            _alive_registrations(event)
            .select_for_update()
            .filter(pk=registration_id, site_id=event.site_id)
            .first()
        )
        if registration is None:
            raise AttendanceNotFound("Participant was not found.")
        resolved_method = _assert_check_in_allowed(registration, override=override)
        if method == AttendanceMethod.QR and resolved_method != AttendanceMethod.OVERRIDE:
            resolved_method = AttendanceMethod.QR
        elif override:
            resolved_method = AttendanceMethod.OVERRIDE
        existing = (
            EventAttendance.objects.select_for_update()
            .filter(registration_id=registration.pk, event_id=event.pk)
            .first()
        )
        if existing is not None:
            record_event(
                action="EVENT_ATTENDANCE_REPLAYED",
                entity_type="cms.event_attendance",
                entity_id=existing.pk,
                after={"registration": str(registration.pk), "method": existing.method},
                changed_fields=[],
            )
            return existing, False
        now = timezone.now()
        row = EventAttendance.objects.create(
            event=event,
            site_id=event.site_id,
            registration=registration,
            checked_in_at=now,
            method=resolved_method,
            operator=actor if getattr(actor, "is_authenticated", False) else None,
            notes=(notes or "").strip()[:255],
        )
        record_event(
            action="EVENT_ATTENDANCE_CHECKED_IN",
            entity_type="cms.event_attendance",
            entity_id=row.pk,
            after={
                "registration": str(registration.pk),
                "method": row.method,
                "override": bool(override),
            },
            changed_fields=["checked_in_at", "method"],
        )
        return row, True


def check_in_by_token(
    event: Event,
    credential: str,
    *,
    actor,
    override: bool = False,
    notes: str = "",
) -> tuple[EventAttendance, bool]:
    token = parse_check_in_credential(credential, event=event)
    registration = _alive_registrations(event).filter(check_in_token=token).first()
    if registration is None:
        raise AttendanceNotFound("Check-in token was not recognized for this Event.")
    return check_in_registration(
        event,
        registration.pk,
        actor=actor,
        method=AttendanceMethod.QR,
        override=override,
        notes=notes,
    )


def check_out_registration(event: Event, registration_id, *, actor) -> EventAttendance:
    with hierarchy_write(), transaction.atomic():
        row = (
            EventAttendance.objects.select_for_update()
            .filter(event_id=event.pk, registration_id=registration_id)
            .first()
        )
        if row is None:
            raise AttendanceNotFound("Attendance was not found.")
        if row.checked_out_at is None:
            row.checked_out_at = timezone.now()
            row.save(update_fields=["checked_out_at", "updated_at"])
            record_event(
                action="EVENT_ATTENDANCE_CHECKED_OUT",
                entity_type="cms.event_attendance",
                entity_id=row.pk,
                after={"registration": str(registration_id)},
                changed_fields=["checked_out_at"],
            )
        return row


def event_report(
    event: Event,
    *,
    status: str = "",
    category: str = "",
    attended: str = "",
    date_from: str = "",
    date_to: str = "",
) -> dict[str, Any]:
    regs = _alive_registrations(event)
    attendance_ids = set(
        EventAttendance.objects.filter(event_id=event.pk).values_list("registration_id", flat=True)
    )
    if status:
        regs = regs.filter(status=status.upper())
    if category:
        regs = regs.filter(display_category=category.upper())
    if attended.lower() in {"1", "true", "yes"}:
        regs = regs.filter(pk__in=attendance_ids)
    elif attended.lower() in {"0", "false", "no"}:
        regs = regs.exclude(pk__in=attendance_ids)

    if date_from or date_to:
        attendance_qs = EventAttendance.objects.filter(event_id=event.pk)
        if date_from:
            start = _parse_day_start(date_from)
            attendance_qs = attendance_qs.filter(checked_in_at__gte=start)
        if date_to:
            end = _parse_day_end(date_to)
            attendance_qs = attendance_qs.filter(checked_in_at__lte=end)
        filtered_ids = list(attendance_qs.values_list("registration_id", flat=True))
        regs = regs.filter(pk__in=filtered_ids)

    summary = registration_summary(event)
    attended_count = EventAttendance.objects.filter(event_id=event.pk).count()
    capacity = event.registration_capacity
    utilization = None
    if capacity and capacity > 0:
        utilization = round(min(1.0, attended_count / capacity), 4)

    category_rows = list(
        _alive_registrations(event)
        .values("display_category")
        .annotate(
            registrations=Count("id"),
            confirmed=Count("id", filter=Q(status=RegistrationStatus.CONFIRMED)),
            waitlisted=Count("id", filter=Q(status=RegistrationStatus.WAITLISTED)),
            cancelled=Count("id", filter=Q(status=RegistrationStatus.CANCELLED)),
        )
        .order_by("display_category")
    )
    attended_by_category = {
        row["registration__display_category"]: row["c"]
        for row in (
            EventAttendance.objects.filter(event_id=event.pk)
            .values("registration__display_category")
            .annotate(c=Count("id"))
        )
    }
    for row in category_rows:
        row["attended"] = attended_by_category.get(row["display_category"], 0)
        row["category"] = row.pop("display_category")

    return {
        "event": str(event.pk),
        "metrics": {
            "registrations": _alive_registrations(event).count(),
            "confirmed": summary["confirmed"],
            "waitlisted": summary["waitlisted"],
            "cancelled": summary["cancelled"],
            "invited": summary["invited"],
            "attended": attended_count,
            "capacity": capacity,
            "seats_remaining": summary["seats_remaining"],
            "capacity_utilization": utilization,
        },
        "categories": category_rows,
        "filters": {
            "status": status or None,
            "category": category or None,
            "attended": attended or None,
            "date_from": date_from or None,
            "date_to": date_to or None,
        },
        "filtered_count": regs.count(),
        "results": [
            {
                "id": str(row.pk),
                "participant_name": row.participant_name,
                "email": row.email,
                "organization": row.organization,
                "status": row.status,
                "display_category": row.display_category,
                "attended": row.pk in attendance_ids,
                "created_at": row.created_at,
            }
            for row in regs.order_by("created_at", "id")[:500]
        ],
    }


def build_report_csv(
    event: Event,
    *,
    status: str = "",
    category: str = "",
    attended: str = "",
    date_from: str = "",
    date_to: str = "",
) -> tuple[str, bytes]:
    report = event_report(
        event,
        status=status,
        category=category,
        attended=attended,
        date_from=date_from,
        date_to=date_to,
    )
    attendance_map = {
        row.registration_id: row
        for row in EventAttendance.objects.filter(event_id=event.pk).select_related()
    }
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(REPORT_CSV_FIELDS)
    for item in report["results"]:
        attendance = attendance_map.get(UUID(item["id"]))
        writer.writerow([
            neutralize_csv_cell(item["id"]),
            neutralize_csv_cell(item["participant_name"]),
            neutralize_csv_cell(item["email"]),
            neutralize_csv_cell(item["organization"]),
            neutralize_csv_cell(item["status"]),
            neutralize_csv_cell(item["display_category"]),
            neutralize_csv_cell("yes" if item["attended"] else "no"),
            neutralize_csv_cell(attendance.checked_in_at if attendance else ""),
            neutralize_csv_cell(attendance.checked_out_at if attendance else ""),
            neutralize_csv_cell(attendance.method if attendance else ""),
        ])
    content = buffer.getvalue().encode("utf-8-sig")
    return f"event-{event.slug}-attendance-report.csv", content


def _parse_day_start(value: str):
    try:
        day = datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as error:
        raise ValidationError({"date_from": ["Use YYYY-MM-DD."]}) from error
    return timezone.make_aware(datetime.combine(day, datetime.min.time()))


def _parse_day_end(value: str):
    try:
        day = datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as error:
        raise ValidationError({"date_to": ["Use YYYY-MM-DD."]}) from error
    return timezone.make_aware(datetime.combine(day, datetime.max.time()))
