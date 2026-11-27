"""Validation, conflicts, ordering and CRUD for Event sessions."""
from __future__ import annotations

import zoneinfo
from datetime import date, datetime
from typing import Any

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from apps.audit.context import audit_context, current_audit_context
from apps.audit.writer import record_event
from apps.cms.blocks import sanitize_rich_text
from apps.cms.event_domain import require_events_admin
from apps.cms.event_models import Event
from apps.cms.event_session_models import (
    EventSession,
    SessionStatus,
    SessionType,
    SessionVisibility,
)
from apps.organizations.hierarchy_lock import hierarchy_write


class SessionConflict(Exception):
    pass


class SessionPreconditionRequired(Exception):
    pass


def session_etag(session: EventSession) -> str:
    return f'"site-event-session-{session.event_id}-{session.pk}-v{session.version}"'


def active_sessions(event: Event):
    return EventSession.objects.filter(event=event, removed_at__isnull=True)


def _parse_dt(value, *, field: str):
    if isinstance(value, datetime):
        return value if timezone.is_aware(value) else timezone.make_aware(value, timezone.utc)
    if isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValidationError({field: ["Enter an ISO-8601 date and time."]}) from error
        if timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed, timezone.utc)
        return parsed
    raise ValidationError({field: ["Enter an ISO-8601 date and time."]})


def _event_tz(event: Event):
    name = (event.timezone or "UTC").strip() or "UTC"
    try:
        return zoneinfo.ZoneInfo(name)
    except (zoneinfo.ZoneInfoNotFoundError, KeyError, ValueError) as error:
        raise ValidationError({"timezone": [f"Unknown Event timezone '{name}'."]}) from error


def _normalize_room(value: str) -> str:
    return " ".join((value or "").strip().lower().split())


def _normalize_speakers(value) -> list[str]:
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise ValidationError({"speaker_labels": ["Provide a list of speaker labels."]})
    labels = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            raise ValidationError({"speaker_labels": ["Speaker labels must be non-empty text."]})
        labels.append(item.strip())
    return labels


def intervals_overlap(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> bool:
    """True when half-open ranges [start, end) overlap, including midnight spans."""
    return a_start < b_end and b_start < a_end


def validate_session(session: EventSession) -> None:
    errors: dict[str, list[str]] = {}
    event = session.event
    if event is None:
        raise ValidationError({"event": ["Event is required."]})

    title = (session.title or "").strip()
    session.title = title
    if not title:
        errors["title"] = ["Enter a session title."]

    try:
        session.description = sanitize_rich_text(session.description or "")
    except Exception as error:
        errors["description"] = [str(error)]

    session.venue_room = (session.venue_room or "").strip()
    session.track = (session.track or "").strip()
    session.public_notes = (session.public_notes or "").strip()
    try:
        session.speaker_labels = _normalize_speakers(session.speaker_labels)
    except ValidationError as error:
        errors.update(error.message_dict)

    if session.session_type not in SessionType.values:
        errors["session_type"] = ["Choose a valid session type."]
    if session.visibility not in SessionVisibility.values:
        errors["visibility"] = ["Choose public or hidden visibility."]
    if session.status not in SessionStatus.values:
        errors["status"] = ["Choose a valid session status."]

    if session.starts_at is None:
        errors["starts_at"] = ["Enter a start date and time."]
    if session.ends_at is None:
        errors["ends_at"] = ["Enter an end date and time."]
    if session.starts_at and session.ends_at and session.ends_at <= session.starts_at:
        errors["ends_at"] = ["End must be after the start date and time."]

    if session.starts_at and session.ends_at and not errors.get("ends_at"):
        try:
            tz = _event_tz(event)
        except ValidationError as error:
            errors.update(error.message_dict)
            tz = None
        if tz is not None:
            local_start = timezone.localtime(session.starts_at, tz)
            session.day_date = local_start.date()
            if event.starts_at and session.starts_at < event.starts_at:
                errors["starts_at"] = ["Session must start on or after the Event start."]
            if event.ends_at and session.ends_at > event.ends_at:
                errors["ends_at"] = ["Session must end on or before the Event end."]

    if session.media_asset_id and session.media_asset and session.media_asset.site_id != event.site_id:
        errors["media_asset"] = ["Choose media owned by this Site."]
    if session.document_id and session.document and session.document.site_id != event.site_id:
        errors["document"] = ["Choose a document owned by this Site."]

    if errors:
        raise ValidationError(errors)


def detect_session_conflicts(event: Event, *, candidate: EventSession | None = None) -> dict[str, list[dict]]:
    """Return room and speaker conflicts. Room conflicts are publish-blocking when configured."""
    rows = list(active_sessions(event).order_by("starts_at", "id"))
    if candidate is not None and candidate.removed_at is None:
        rows = [row for row in rows if row.pk != candidate.pk] + [candidate]
    from apps.cms.event_person_domain import person_ids_for_sessions
    from apps.cms.event_person_models import EventPerson

    assigned = person_ids_for_sessions([row.pk for row in rows if row.pk])
    person_names = {
        str(pk): name
        for pk, name in EventPerson.objects.filter(
            event=event, removed_at__isnull=True, pk__in={pid for ids in assigned.values() for pid in ids},
        ).values_list("pk", "display_name")
    }
    room_conflicts: list[dict] = []
    speaker_warnings: list[dict] = []
    for index, left in enumerate(rows):
        if left.status == SessionStatus.CANCELLED:
            continue
        left_room = _normalize_room(left.venue_room)
        left_labels = {label.lower() for label in (left.speaker_labels or [])}
        left_people = set(assigned.get(str(left.pk), set()))
        for right in rows[index + 1:]:
            if right.status == SessionStatus.CANCELLED:
                continue
            if not intervals_overlap(left.starts_at, left.ends_at, right.starts_at, right.ends_at):
                continue
            right_room = _normalize_room(right.venue_room)
            if left_room and left_room == right_room:
                room_conflicts.append({
                    "type": "room",
                    "message": f"Sessions overlap in room '{left.venue_room}'.",
                    "session_ids": [str(left.pk) if left.pk else "candidate", str(right.pk) if right.pk else "candidate"],
                    "room": left.venue_room,
                })
            right_labels = {label.lower() for label in (right.speaker_labels or [])}
            shared_labels = left_labels & right_labels
            shared_people = left_people & set(assigned.get(str(right.pk), set()))
            if shared_labels or shared_people:
                names = sorted({
                    *shared_labels,
                    *(person_names.get(pid, pid) for pid in shared_people),
                })
                speaker_warnings.append({
                    "type": "speaker",
                    "message": f"Speaker conflict for: {', '.join(names)}.",
                    "session_ids": [str(left.pk) if left.pk else "candidate", str(right.pk) if right.pk else "candidate"],
                    "speakers": names,
                    "person_ids": sorted(shared_people),
                })
    return {"room_conflicts": room_conflicts, "speaker_warnings": speaker_warnings}


def room_conflicts_block_publish(site) -> bool:
    settings_obj = getattr(site, "event_settings", None)
    if settings_obj is None:
        from apps.sites.models.event_settings import SiteEventSettings
        settings_obj = SiteEventSettings.objects.filter(site=site).first()
    if settings_obj is None:
        return True
    return bool(getattr(settings_obj, "block_publish_on_session_room_conflicts", True))


def assert_publishable_schedule(event: Event) -> None:
    conflicts = detect_session_conflicts(event)
    if conflicts["room_conflicts"] and room_conflicts_block_publish(event.site):
        raise ValidationError({
            "sessions": [
                "Resolve same-room schedule conflicts before publishing this Event.",
                *[item["message"] for item in conflicts["room_conflicts"]],
            ],
        })


def create_session(event: Event, payload: dict[str, Any], *, actor) -> EventSession:
    require_events_admin(actor, event.site)
    session = EventSession(event=event, created_by=actor, updated_by=actor)
    _assign(session, payload)
    if "sort_order" not in payload:
        current = active_sessions(event).aggregate(Max("sort_order"))["sort_order__max"]
        session.sort_order = 0 if current is None else current + 1
    with hierarchy_write():
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id):
            session.save()
            record_event(
                action="EVENT_SESSION_CREATED", entity_type="cms.event_session", entity_id=session.pk,
                after=_snapshot(session), changed_fields=sorted(_snapshot(session)),
            )
    return session


def update_session(session: EventSession, payload: dict[str, Any], *, actor, expected: str | None) -> EventSession:
    require_events_admin(actor, session.event.site)
    if session.removed_at is not None:
        raise ValidationError({"detail": ["This session was removed."]})
    if not expected:
        raise SessionPreconditionRequired()
    if expected != session_etag(session):
        raise SessionConflict()
    before = _snapshot(session)
    _assign(session, payload)
    session.updated_by = actor
    if session.status == SessionStatus.SCHEDULED and before != _snapshot(session):
        # Keep SCHEDULED unless caller sets another status; mark UPDATED when content changes after schedule.
        if "status" not in payload:
            session.status = SessionStatus.UPDATED
    with hierarchy_write():
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id):
            session.save()
            after = _snapshot(session)
            changed = [key for key in after if before.get(key) != after[key]]
            if changed:
                record_event(
                    action="EVENT_SESSION_UPDATED", entity_type="cms.event_session", entity_id=session.pk,
                    before=before, after=after, changed_fields=changed,
                )
    return session


def duplicate_session(session: EventSession, *, actor) -> EventSession:
    require_events_admin(actor, session.event.site)
    payload = {
        "title": f"{session.title} (Copy)",
        "description": session.description,
        "session_type": session.session_type,
        "venue_room": session.venue_room,
        "track": session.track,
        "starts_at": session.starts_at,
        "ends_at": session.ends_at,
        "day_date": session.day_date,
        "visibility": session.visibility,
        "public_notes": session.public_notes,
        "speaker_labels": list(session.speaker_labels or []),
        "media_asset": session.media_asset_id,
        "document": session.document_id,
    }
    return create_session(session.event, payload, actor=actor)


def remove_session(session: EventSession, *, actor, expected: str | None) -> EventSession:
    """Soft-remove a session. Media/document rows stay intact."""
    require_events_admin(actor, session.event.site)
    if not expected:
        raise SessionPreconditionRequired()
    if expected != session_etag(session):
        raise SessionConflict()
    if session.removed_at is not None:
        return session
    before = _snapshot(session)
    session.removed_at = timezone.now()
    session.updated_by = actor
    with hierarchy_write():
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id):
            # Bypass full_clean boundary checks for already-valid removed rows by using update_fields path.
            EventSession.objects.filter(pk=session.pk).update(
                removed_at=session.removed_at,
                updated_by=actor,
                updated_at=timezone.now(),
            )
            session.refresh_from_db()
            record_event(
                action="EVENT_SESSION_REMOVED", entity_type="cms.event_session", entity_id=session.pk,
                before=before, after=_snapshot(session), changed_fields=["removed_at"],
            )
    return session


def reorder_sessions(event: Event, ordered_ids: list[str], *, actor, expected_event_etag: str | None = None) -> list[EventSession]:
    require_events_admin(actor, event.site)
    from apps.cms.event_domain import event_etag
    if not expected_event_etag:
        raise SessionPreconditionRequired()
    if expected_event_etag != event_etag(event):
        raise SessionConflict()
    ids = [str(value) for value in ordered_ids]
    rows = list(active_sessions(event).filter(pk__in=ids))
    if len(rows) != len(set(ids)):
        raise ValidationError({"order": ["Include only active sessions from this Event, each once."]})
    by_id = {str(row.pk): row for row in rows}
    with hierarchy_write(), transaction.atomic():
        for index, session_id in enumerate(ids):
            row = by_id[session_id]
            EventSession.objects.filter(pk=row.pk).update(sort_order=index, updated_by=actor, updated_at=timezone.now())
        # Bump Event version so concurrent reorders cannot silently race on the same ETag.
        Event.objects.filter(pk=event.pk).update(updated_by=actor, updated_at=timezone.now())
        event.refresh_from_db()
        record_event(
            action="EVENT_SESSIONS_REORDERED", entity_type="cms.event", entity_id=event.pk,
            after={"order": ids}, changed_fields=["sessions"],
        )
    return list(active_sessions(event))


def _public_session_rows(event: Event):
    rows = active_sessions(event).filter(visibility=SessionVisibility.PUBLIC).order_by(
        "day_date", "sort_order", "starts_at", "id",
    )
    from apps.sites.models.event_settings import SiteEventSettings
    settings_obj = SiteEventSettings.objects.filter(site_id=event.site_id).first()
    hide_cancelled = bool(settings_obj.hide_cancelled_sessions_publicly) if settings_obj else False
    if hide_cancelled:
        rows = rows.exclude(status=SessionStatus.CANCELLED)
    return rows


def public_schedule_available(event: Event) -> bool:
    return _public_session_rows(event).exists()


def public_agenda_etag(event: Event) -> str:
    """Section ETag from session rows only — Event root republish is not required."""
    latest = _public_session_rows(event).order_by("-updated_at", "-version").values_list(
        "updated_at", "version",
    ).first()
    if not latest:
        return f'"site-event-agenda-{event.pk}-empty"'
    stamp = latest[0].isoformat() if latest[0] else "0"
    return f'"site-event-agenda-{event.pk}-v{latest[1]}-{stamp}"'


def public_agenda(event: Event) -> list[dict[str, Any]]:
    """Group public sessions by day then track. Hidden/cancelled-hidden stay out."""
    days: dict[str, dict[str, Any]] = {}
    for row in _public_session_rows(event):
        day_key = row.day_date.isoformat()
        day = days.setdefault(day_key, {"date": day_key, "tracks": {}})
        track_key = row.track or "General"
        track = day["tracks"].setdefault(track_key, {"track": track_key, "sessions": []})
        track["sessions"].append(serialize_session(row, public=True))
    result = []
    for day in days.values():
        result.append({
            "date": day["date"],
            "tracks": list(day["tracks"].values()),
        })
    return result


def serialize_session(session: EventSession, *, public: bool = False, conflicts: dict | None = None) -> dict[str, Any]:
    from apps.cms.event_person_domain import public_people_for_session, serialize_assignment, active_assignments
    people = (
        public_people_for_session(session)
        if public
        else [serialize_assignment(row, public=False) for row in active_assignments(session)]
    )
    payload = {
        "id": session.pk,
        "event": session.event_id,
        "day_date": session.day_date.isoformat() if session.day_date else None,
        "starts_at": session.starts_at,
        "ends_at": session.ends_at,
        "title": session.title,
        "description": session.description,
        "session_type": session.session_type,
        "venue_room": session.venue_room,
        "track": session.track,
        "sort_order": session.sort_order,
        "visibility": session.visibility,
        "status": session.status,
        "public_notes": session.public_notes,
        "speaker_labels": list(session.speaker_labels or []),
        "people": people,
        "version": session.version,
        "updated_at": session.updated_at,
    }
    if not public:
        payload.update({
            "media_asset": session.media_asset_id,
            "document": session.document_id,
            "removed_at": session.removed_at,
            "created_at": session.created_at,
        })
        if conflicts is not None:
            payload["conflicts"] = conflicts
    return payload


def _assign(session: EventSession, payload: dict[str, Any]) -> None:
    mapping = {
        "title": "title",
        "description": "description",
        "session_type": "session_type",
        "venue_room": "venue_room",
        "track": "track",
        "visibility": "visibility",
        "status": "status",
        "public_notes": "public_notes",
        "sort_order": "sort_order",
    }
    for key, attr in mapping.items():
        if key in payload:
            setattr(session, attr, payload[key])
    if "starts_at" in payload:
        session.starts_at = _parse_dt(payload["starts_at"], field="starts_at")
    if "ends_at" in payload:
        session.ends_at = _parse_dt(payload["ends_at"], field="ends_at")
    if "day_date" in payload and payload["day_date"]:
        value = payload["day_date"]
        session.day_date = value if isinstance(value, date) else date.fromisoformat(str(value))
    elif session.starts_at and not session.day_date:
        # Satisfy non-null day_date before Model.clean_fields; validate_session may refine in Event TZ.
        session.day_date = timezone.localtime(session.starts_at).date()
    if "speaker_labels" in payload:
        session.speaker_labels = _normalize_speakers(payload["speaker_labels"])
    if "media_asset" in payload:
        session.media_asset_id = payload["media_asset"] or None
    if "document" in payload:
        session.document_id = payload["document"] or None


def _snapshot(session: EventSession) -> dict[str, Any]:
    return {
        "title": session.title,
        "day_date": session.day_date.isoformat() if session.day_date else None,
        "starts_at": session.starts_at.isoformat() if session.starts_at else None,
        "ends_at": session.ends_at.isoformat() if session.ends_at else None,
        "session_type": session.session_type,
        "venue_room": session.venue_room,
        "track": session.track,
        "sort_order": session.sort_order,
        "visibility": session.visibility,
        "status": session.status,
        "speaker_labels": list(session.speaker_labels or []),
        "removed_at": session.removed_at.isoformat() if session.removed_at else None,
    }
