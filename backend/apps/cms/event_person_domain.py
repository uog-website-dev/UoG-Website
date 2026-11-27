"""CRUD, validation and public serialization for Event people and session roles."""
from __future__ import annotations

from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Max, Prefetch
from django.utils import timezone

from apps.audit.context import audit_context, current_audit_context
from apps.audit.writer import record_event
from apps.cms.blocks import Rejection, check_image_ref, sanitize_rich_text
from apps.cms.event_domain import require_events_admin
from apps.cms.event_models import Event
from apps.cms.event_person_models import (
    EventPerson,
    SessionPerson,
    SessionPersonRole,
)
from apps.cms.event_session_models import SessionVisibility
from apps.cms.event_session_models import EventSession
from apps.cms.menu_models import validate_external_url
from apps.organizations.hierarchy_lock import hierarchy_write


class PersonConflict(Exception):
    pass


class PersonPreconditionRequired(Exception):
    pass


def person_etag(person: EventPerson) -> str:
    return f'"site-event-person-{person.event_id}-{person.pk}-v{person.version}"'


def active_people(event: Event):
    return EventPerson.objects.filter(event=event, removed_at__isnull=True)


def active_assignments(session: EventSession):
    return SessionPerson.objects.filter(
        session=session,
        person__removed_at__isnull=True,
    ).select_related("person", "person__event")


def _validate_portrait(asset_id, *, site_id: int):
    if asset_id in (None, ""):
        return None
    try:
        asset_uuid = asset_id if isinstance(asset_id, UUID) else UUID(str(asset_id))
    except (TypeError, ValueError, AttributeError) as error:
        raise ValidationError({"profile_photo": ["Choose a Site media image."]}) from error
    from apps.media.models import MediaAsset
    asset = MediaAsset.objects.filter(pk=asset_uuid, site_id=site_id).first()
    if asset is None:
        raise ValidationError({"profile_photo": ["Choose a media image owned by this Site."]})
    if asset.status != "READY" or not str(asset.detected_mime or "").startswith("image/"):
        raise ValidationError({"profile_photo": ["Only a ready image owned by this Site may be selected."]})
    try:
        check_image_ref(f"sites/{site_id}/assets/{asset.pk}", site_id=site_id)
    except Rejection as error:
        raise ValidationError({"profile_photo": [str(error)]}) from error
    return asset


def _normalize_public_links(value) -> list[dict[str, str]]:
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise ValidationError({"public_links": ["Provide a list of labelled links."]})
    links = []
    for item in value:
        if not isinstance(item, dict):
            raise ValidationError({"public_links": ["Each link must include label and url."]})
        label = str(item.get("label") or "").strip()
        url = str(item.get("url") or "").strip()
        if not label or not url:
            raise ValidationError({"public_links": ["Each link must include label and url."]})
        try:
            validate_external_url(url)
        except ValidationError as error:
            messages = list(getattr(error, "messages", [str(error)]))
            if getattr(error, "message_dict", None):
                messages = [msg for group in error.message_dict.values() for msg in group]
            raise ValidationError({"public_links": messages or ["Enter a safe http(s) URL."]}) from error
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            raise ValidationError({"public_links": ["Public links must use http or https."]})
        links.append({"label": label[:120], "url": url})
    return links


def validate_person(person: EventPerson) -> None:
    errors: dict[str, list[str]] = {}
    if person.event_id is None:
        raise ValidationError({"event": ["Event is required."]})
    name = (person.display_name or "").strip()
    person.display_name = name
    if not name:
        errors["display_name"] = ["Enter a display name."]
    person.affiliation = (person.affiliation or "").strip()
    person.private_email = (person.private_email or "").strip()
    person.private_phone = (person.private_phone or "").strip()
    try:
        person.biography = sanitize_rich_text(person.biography or "")
    except Exception as error:
        errors["biography"] = [str(error)]
    try:
        person.public_links = _normalize_public_links(person.public_links)
    except ValidationError as error:
        errors.update(error.message_dict)
    if person.visibility not in SessionVisibility.values:
        errors["visibility"] = ["Choose public or hidden visibility."]
    if person.profile_photo_id:
        try:
            person.profile_photo = _validate_portrait(
                person.profile_photo_id, site_id=person.event.site_id,
            )
        except ValidationError as error:
            errors.update(error.message_dict)
    if person.verified_account_id and person.verified_account and not person.verified_account.is_active:
        errors["verified_account"] = ["Verified account must be an active platform user."]
    if errors:
        raise ValidationError(errors)


def validate_assignment(assignment: SessionPerson) -> None:
    errors: dict[str, list[str]] = {}
    if assignment.session_id is None:
        raise ValidationError({"session": ["Session is required."]})
    if assignment.person_id is None:
        raise ValidationError({"person": ["Person is required."]})
    session = assignment.session
    person = assignment.person
    if person.removed_at is not None:
        errors["person"] = ["Choose an active Event person."]
    if session.removed_at is not None:
        errors["session"] = ["Choose an active session."]
    if person.event_id != session.event_id:
        errors["person"] = ["Person and session must belong to the same Event."]
    if assignment.role not in SessionPersonRole.values:
        errors["role"] = ["Choose a valid session role."]
    if errors:
        raise ValidationError(errors)


def create_person(event: Event, payload: dict[str, Any], *, actor) -> EventPerson:
    require_events_admin(actor, event.site)
    person = EventPerson(event=event, created_by=actor, updated_by=actor)
    _assign_person(person, payload)
    if "sort_order" not in payload:
        current = active_people(event).aggregate(Max("sort_order"))["sort_order__max"]
        person.sort_order = 0 if current is None else current + 1
    with hierarchy_write():
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id):
            person.save()
            record_event(
                action="EVENT_PERSON_CREATED", entity_type="cms.event_person", entity_id=person.pk,
                after=_person_snapshot(person), changed_fields=sorted(_person_snapshot(person)),
            )
    return person


def update_person(person: EventPerson, payload: dict[str, Any], *, actor, expected: str | None) -> EventPerson:
    require_events_admin(actor, person.event.site)
    if person.removed_at is not None:
        raise ValidationError({"detail": ["This person was removed."]})
    if not expected:
        raise PersonPreconditionRequired()
    if expected != person_etag(person):
        raise PersonConflict()
    before = _person_snapshot(person)
    _assign_person(person, payload)
    person.updated_by = actor
    with hierarchy_write():
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id):
            person.save()
            after = _person_snapshot(person)
            changed = [key for key in after if before.get(key) != after[key]]
            if changed:
                record_event(
                    action="EVENT_PERSON_UPDATED", entity_type="cms.event_person", entity_id=person.pk,
                    before=before, after=after, changed_fields=changed,
                )
    return person


def remove_person(person: EventPerson, *, actor, expected: str | None) -> EventPerson:
    """Soft-remove a person profile. Session assignments remain historically linked but inactive in public views."""
    require_events_admin(actor, person.event.site)
    if not expected:
        raise PersonPreconditionRequired()
    if expected != person_etag(person):
        raise PersonConflict()
    if person.removed_at is not None:
        return person
    before = _person_snapshot(person)
    person.removed_at = timezone.now()
    person.updated_by = actor
    with hierarchy_write():
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id):
            EventPerson.objects.filter(pk=person.pk).update(
                removed_at=person.removed_at,
                updated_by=actor,
                updated_at=timezone.now(),
            )
            person.refresh_from_db()
            record_event(
                action="EVENT_PERSON_REMOVED", entity_type="cms.event_person", entity_id=person.pk,
                before=before, after=_person_snapshot(person), changed_fields=["removed_at"],
            )
    return person


def assign_person(
    session: EventSession,
    *,
    person: EventPerson,
    role: str,
    sort_order: int | None,
    actor,
) -> SessionPerson:
    require_events_admin(actor, session.event.site)
    if session.removed_at is not None:
        raise ValidationError({"session": ["Choose an active session."]})
    if person.event_id != session.event_id:
        raise ValidationError({"person": ["Person and session must belong to the same Event."]})
    if person.removed_at is not None:
        raise ValidationError({"person": ["Choose an active Event person."]})
    if role not in SessionPersonRole.values:
        raise ValidationError({"role": ["Choose a valid session role."]})
    existing = SessionPerson.objects.filter(session=session, person=person, role=role).first()
    if existing is not None:
        if sort_order is not None and existing.sort_order != sort_order:
            existing.sort_order = sort_order
            existing.updated_by = actor
            existing.save()
        return existing
    order = sort_order
    if order is None:
        current = active_assignments(session).aggregate(Max("sort_order"))["sort_order__max"]
        order = 0 if current is None else current + 1
    assignment = SessionPerson(
        session=session,
        person=person,
        role=role,
        sort_order=order,
        created_by=actor,
        updated_by=actor,
    )
    with hierarchy_write():
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id):
            assignment.save()
            record_event(
                action="EVENT_SESSION_PERSON_ASSIGNED", entity_type="cms.session_person",
                entity_id=assignment.pk,
                after=_assignment_snapshot(assignment), changed_fields=["person", "role", "sort_order"],
            )
    return assignment


def update_assignment(
    assignment: SessionPerson,
    payload: dict[str, Any],
    *,
    actor,
) -> SessionPerson:
    require_events_admin(actor, assignment.session.event.site)
    if "role" in payload:
        role = payload["role"]
        if role not in SessionPersonRole.values:
            raise ValidationError({"role": ["Choose a valid session role."]})
        assignment.role = role
    if "sort_order" in payload:
        assignment.sort_order = int(payload["sort_order"])
    assignment.updated_by = actor
    with hierarchy_write():
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id):
            assignment.save()
            record_event(
                action="EVENT_SESSION_PERSON_UPDATED", entity_type="cms.session_person",
                entity_id=assignment.pk,
                after=_assignment_snapshot(assignment), changed_fields=["role", "sort_order"],
            )
    return assignment


def unassign_person(assignment: SessionPerson, *, actor) -> None:
    """Remove a session assignment without deleting the EventPerson profile."""
    require_events_admin(actor, assignment.session.event.site)
    before = _assignment_snapshot(assignment)
    assignment_id = assignment.pk
    with hierarchy_write(), transaction.atomic():
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id):
            assignment.delete()
            record_event(
                action="EVENT_SESSION_PERSON_UNASSIGNED", entity_type="cms.session_person",
                entity_id=assignment_id,
                before=before, after={}, changed_fields=["deleted"],
            )


def reorder_assignments(session: EventSession, ordered_ids: list[str], *, actor) -> list[SessionPerson]:
    require_events_admin(actor, session.event.site)
    ids = [str(value) for value in ordered_ids]
    rows = list(active_assignments(session).filter(pk__in=ids))
    if len(rows) != len(set(ids)):
        raise ValidationError({"order": ["Include only assignments from this session, each once."]})
    by_id = {str(row.pk): row for row in rows}
    with hierarchy_write(), transaction.atomic():
        for index, assignment_id in enumerate(ids):
            SessionPerson.objects.filter(pk=by_id[assignment_id].pk).update(
                sort_order=index, updated_by=actor, updated_at=timezone.now(),
            )
    return list(active_assignments(session))


def person_ids_for_sessions(session_ids: list) -> dict[str, set[str]]:
    """Map session id -> set of active person ids assigned to that session."""
    if not session_ids:
        return {}
    result: dict[str, set[str]] = {str(session_id): set() for session_id in session_ids}
    rows = SessionPerson.objects.filter(
        session_id__in=session_ids,
        person__removed_at__isnull=True,
    ).values_list("session_id", "person_id")
    for session_id, person_id in rows:
        result.setdefault(str(session_id), set()).add(str(person_id))
    return result


def serialize_person(person: EventPerson, *, public: bool = False) -> dict[str, Any]:
    photo_url = None
    include_photo = bool(person.profile_photo_id) and (
        not public or person.visibility == SessionVisibility.PUBLIC
    )
    if include_photo:
        photo_url = (
            f"/api/v1/sites/{person.event.site_id}/assets/{person.profile_photo_id}/image/?variant=display"
        )
    if public:
        if person.visibility != SessionVisibility.PUBLIC or person.removed_at is not None:
            return {}
        return {
            "id": person.pk,
            "display_name": person.display_name,
            "affiliation": person.affiliation,
            "biography": person.biography,
            "profile_photo_url": photo_url,
            "public_links": list(person.public_links or []),
            "sort_order": person.sort_order,
        }
    return {
        "id": person.pk,
        "event": person.event_id,
        "display_name": person.display_name,
        "affiliation": person.affiliation,
        "biography": person.biography,
        "profile_photo": person.profile_photo_id,
        "profile_photo_url": photo_url,
        "public_links": list(person.public_links or []),
        "visibility": person.visibility,
        "private_email": person.private_email,
        "private_phone": person.private_phone,
        "verified_account": person.verified_account_id,
        "sort_order": person.sort_order,
        "version": person.version,
        "removed_at": person.removed_at,
        "created_at": person.created_at,
        "updated_at": person.updated_at,
    }


def serialize_assignment(assignment: SessionPerson, *, public: bool = False) -> dict[str, Any]:
    person_payload = serialize_person(assignment.person, public=public)
    if public and not person_payload:
        return {}
    payload = {
        "id": assignment.pk,
        "session": assignment.session_id,
        "person": assignment.person_id,
        "role": assignment.role,
        "sort_order": assignment.sort_order,
        "person_summary": person_payload,
    }
    if not public:
        payload["updated_at"] = assignment.updated_at
    return payload


def public_people_for_session(session: EventSession) -> list[dict[str, Any]]:
    rows = (
        active_assignments(session)
        .filter(person__visibility=SessionVisibility.PUBLIC)
        .order_by("sort_order", "role", "id")
    )
    result = []
    for row in rows:
        payload = serialize_assignment(row, public=True)
        if payload:
            result.append(payload)
    return result


def _assign_person(person: EventPerson, payload: dict[str, Any]) -> None:
    mapping = {
        "display_name": "display_name",
        "affiliation": "affiliation",
        "biography": "biography",
        "visibility": "visibility",
        "private_email": "private_email",
        "private_phone": "private_phone",
        "sort_order": "sort_order",
    }
    for key, attr in mapping.items():
        if key in payload:
            setattr(person, attr, payload[key])
    if "public_links" in payload:
        person.public_links = _normalize_public_links(payload["public_links"])
    if "profile_photo" in payload:
        person.profile_photo_id = payload["profile_photo"] or None
    if "verified_account" in payload:
        person.verified_account_id = payload["verified_account"] or None


def _person_snapshot(person: EventPerson) -> dict[str, Any]:
    return {
        "display_name": person.display_name,
        "affiliation": person.affiliation,
        "visibility": person.visibility,
        "sort_order": person.sort_order,
        "profile_photo": str(person.profile_photo_id) if person.profile_photo_id else None,
        "private_email": person.private_email,
        "removed_at": person.removed_at.isoformat() if person.removed_at else None,
    }


def _assignment_snapshot(assignment: SessionPerson) -> dict[str, Any]:
    return {
        "session": str(assignment.session_id),
        "person": str(assignment.person_id),
        "role": assignment.role,
        "sort_order": assignment.sort_order,
    }


def prefetch_session_people(queryset):
    return queryset.prefetch_related(
        Prefetch(
            "person_assignments",
            queryset=SessionPerson.objects.filter(person__removed_at__isnull=True)
            .select_related("person")
            .order_by("sort_order", "role", "id"),
        ),
    )
