"""Create, publish and list Event updates; public-safe serializers."""
from __future__ import annotations

from typing import Any

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from django.utils.html import strip_tags

from apps.audit.writer import record_event
from apps.cms.blocks import sanitize_rich_text
from apps.cms.event_models import Event, EventStatus
from apps.cms.event_update_models import EventUpdate, UpdateSeverity, UpdateStatus
from apps.organizations.hierarchy_lock import hierarchy_write

# Public list freshness target (seconds). Clients and CDN must revalidate promptly.
PUBLIC_UPDATES_MAX_AGE = 30


class UpdateConflict(Exception):
    pass


class UpdateNotFound(Exception):
    pass


def sanitize_plain(value: str, *, max_length: int) -> str:
    return strip_tags(value or "").replace("\x00", "").strip()[:max_length]


def active_updates(event: Event):
    return EventUpdate.objects.filter(event_id=event.pk)


def public_updates_available(event: Event) -> bool:
    if event.status != EventStatus.PUBLISHED:
        return False
    return active_updates(event).filter(
        status=UpdateStatus.PUBLISHED, published_at__isnull=False,
    ).exists()


def public_updates_etag(event: Event) -> str:
    latest = (
        active_updates(event)
        .filter(status=UpdateStatus.PUBLISHED)
        .order_by("-updated_at", "-published_at", "id")
        .values_list("updated_at", "version")
        .first()
    )
    if not latest:
        return f'"event-updates-{event.pk}-empty"'
    stamp, version = latest
    return f'"event-updates-{event.pk}-v{version}-{stamp.isoformat()}"'


def serialize_update(row: EventUpdate, *, public: bool = False) -> dict[str, Any]:
    payload = {
        "id": row.pk,
        "title": row.title,
        "body": row.body,
        "severity": row.severity,
        "pinned": row.pinned,
        "published_at": row.published_at,
        "updated_at": row.updated_at,
    }
    if public:
        return payload
    payload.update({
        "event": row.event_id,
        "status": row.status,
        "unpublished_at": row.unpublished_at,
        "version": row.version,
        "created_by": row.created_by_id,
        "updated_by": row.updated_by_id,
        "created_at": row.created_at,
    })
    return payload


def create_update(event: Event, payload: dict[str, Any], *, actor) -> EventUpdate:
    title = sanitize_plain(payload.get("title", ""), max_length=255)
    body = sanitize_rich_text(payload.get("body", "") or "")
    severity = str(payload.get("severity") or UpdateSeverity.INFO).upper()
    pinned = bool(payload.get("pinned"))
    errors: dict[str, list[str]] = {}
    if not title:
        errors["title"] = ["Enter an update title."]
    if severity not in UpdateSeverity.values:
        errors["severity"] = ["Choose a valid severity."]
    if errors:
        raise ValidationError(errors)
    with hierarchy_write(), transaction.atomic():
        row = EventUpdate(
            event=event,
            site_id=event.site_id,
            title=title,
            body=body,
            severity=severity,
            pinned=pinned,
            status=UpdateStatus.DRAFT,
            created_by=actor if getattr(actor, "is_authenticated", False) else None,
            updated_by=actor if getattr(actor, "is_authenticated", False) else None,
        )
        row.save()
        record_event(
            action="EVENT_UPDATE_CREATED",
            entity_type="cms.event_update",
            entity_id=row.pk,
            after={"event": str(event.pk), "status": row.status, "severity": row.severity},
            changed_fields=["status"],
        )
        return row


def update_update(
    event: Event, update_id, payload: dict[str, Any], *, actor, expected_version: int | None = None,
) -> EventUpdate:
    with hierarchy_write(), transaction.atomic():
        row = active_updates(event).select_for_update().filter(pk=update_id).first()
        if row is None:
            raise UpdateNotFound("Update was not found.")
        if expected_version is not None and row.version != expected_version:
            raise UpdateConflict("Update was modified by another editor.")
        changed: list[str] = []
        if "title" in payload:
            title = sanitize_plain(payload.get("title", ""), max_length=255)
            if not title:
                raise ValidationError({"title": ["Enter an update title."]})
            row.title = title
            changed.append("title")
        if "body" in payload:
            row.body = sanitize_rich_text(payload.get("body", "") or "")
            changed.append("body")
        if "severity" in payload:
            severity = str(payload.get("severity") or "").upper()
            if severity not in UpdateSeverity.values:
                raise ValidationError({"severity": ["Choose a valid severity."]})
            row.severity = severity
            changed.append("severity")
        if "pinned" in payload:
            row.pinned = bool(payload.get("pinned"))
            changed.append("pinned")
        if not changed:
            return row
        # Published content edits stay published; drafts remain drafts.
        row.version += 1
        row.updated_by = actor if getattr(actor, "is_authenticated", False) else None
        row.save()
        record_event(
            action="EVENT_UPDATE_UPDATED",
            entity_type="cms.event_update",
            entity_id=row.pk,
            after={field: getattr(row, field) for field in changed},
            changed_fields=changed,
        )
        return row


def set_update_status(
    event: Event, update_id, *, action: str, actor, expected_version: int | None = None,
) -> EventUpdate:
    action = (action or "").strip().lower()
    if action not in {"publish", "unpublish"}:
        raise ValidationError({"action": ["Action must be publish or unpublish."]})
    with hierarchy_write(), transaction.atomic():
        row = active_updates(event).select_for_update().filter(pk=update_id).first()
        if row is None:
            raise UpdateNotFound("Update was not found.")
        if expected_version is not None and row.version != expected_version:
            raise UpdateConflict("Update was modified by another editor.")
        now = timezone.now()
        if action == "publish":
            if not (row.title or "").strip():
                raise ValidationError({"title": ["Enter a title before publishing."]})
            row.status = UpdateStatus.PUBLISHED
            row.published_at = row.published_at or now
            row.unpublished_at = None
            audit = "EVENT_UPDATE_PUBLISHED"
        else:
            row.status = UpdateStatus.UNPUBLISHED
            row.unpublished_at = now
            # Keep published_at for history; public list filters on status.
            audit = "EVENT_UPDATE_UNPUBLISHED"
        row.version += 1
        row.updated_by = actor if getattr(actor, "is_authenticated", False) else None
        row.save(update_fields=[
            "status", "published_at", "unpublished_at", "version", "updated_by", "updated_at",
        ])
        record_event(
            action=audit,
            entity_type="cms.event_update",
            entity_id=row.pk,
            after={"status": row.status, "pinned": row.pinned},
            changed_fields=["status"],
        )
        return row


def list_admin_updates(event: Event) -> list[dict[str, Any]]:
    rows = active_updates(event).order_by("-pinned", "-published_at", "-created_at", "id")
    return [serialize_update(row, public=False) for row in rows]


def list_public_updates(event: Event) -> list[dict[str, Any]]:
    if event.status != EventStatus.PUBLISHED:
        return []
    rows = (
        active_updates(event)
        .filter(status=UpdateStatus.PUBLISHED, published_at__isnull=False)
        .order_by("-pinned", "-published_at", "-created_at", "id")
    )
    return [serialize_update(row, public=True) for row in rows]


def list_public_notices(event: Event, *, limit: int = 5) -> list[dict[str, Any]]:
    """Pinned / important / urgent notices for Overview prominence."""
    from django.db.models import Q

    if event.status != EventStatus.PUBLISHED:
        return []
    rows = (
        active_updates(event)
        .filter(status=UpdateStatus.PUBLISHED, published_at__isnull=False)
        .filter(Q(pinned=True) | Q(severity__in=[UpdateSeverity.IMPORTANT, UpdateSeverity.URGENT]))
        .order_by("-pinned", "-published_at", "id")[: max(1, min(limit, 10))]
    )
    return [serialize_update(row, public=True) for row in rows]
