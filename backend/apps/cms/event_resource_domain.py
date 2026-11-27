"""Create, publish and list Event resource associations without duplicating files."""
from __future__ import annotations

from typing import Any
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from django.utils.html import strip_tags

from apps.audit.writer import record_event
from apps.cms.event_models import Event, EventStatus
from apps.cms.event_resource_models import (
    EventResource,
    ResourceCategory,
    ResourceVisibility,
)
from apps.cms.event_session_models import EventSession
from apps.cms.models import Document
from apps.media.document_references import validate_document_file
from apps.organizations.hierarchy_lock import hierarchy_write


class ResourceConflict(Exception):
    pass


class ResourceNotFound(Exception):
    pass


def sanitize_plain(value: str, *, max_length: int) -> str:
    return strip_tags(value or "").replace("\x00", "").strip()[:max_length]


def active_resources(event: Event):
    return EventResource.objects.filter(event_id=event.pk, removed_at__isnull=True)


def public_resources_available(event: Event) -> bool:
    if event.status != EventStatus.PUBLISHED:
        return False
    return active_resources(event).filter(
        visibility__in=[ResourceVisibility.PUBLIC, ResourceVisibility.REGISTERED_ONLY],
        published_at__isnull=False,
    ).exists()


def _file_meta(document: Document) -> dict[str, Any]:
    try:
        asset = validate_document_file(document.file_reference, document.site_id)
    except ValidationError:
        return {
            "file_ready": False,
            "file_type": None,
            "original_filename": None,
            "file_size": None,
        }
    return {
        "file_ready": True,
        "file_type": asset.detected_mime,
        "original_filename": asset.original_filename,
        "file_size": asset.byte_count,
    }


def serialize_resource(row: EventResource, *, public: bool = False) -> dict[str, Any]:
    meta = _file_meta(row.document)
    payload = {
        "id": row.pk,
        "event": row.event_id,
        "session": row.session_id,
        "session_title": row.session.title if row.session_id and getattr(row, "session", None) else None,
        "document": row.document_id,
        "title": row.title,
        "description": row.description,
        "category": row.category,
        "sort_order": row.sort_order,
        "visibility": row.visibility,
        "published_at": row.published_at,
        "file_type": meta["file_type"],
        "original_filename": meta["original_filename"],
        "file_size": meta["file_size"],
        "file_ready": meta["file_ready"],
        "version": row.version,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }
    if public:
        payload["requires_registration"] = row.visibility == ResourceVisibility.REGISTERED_ONLY
        payload["download_path"] = (
            f"/api/v1/site-context/events/{row.event.slug}/resources/{row.pk}/file/"
            if meta["file_ready"] and row.visibility == ResourceVisibility.PUBLIC
            else None
        )
        payload.pop("document", None)
        # Never expose draft/unpublished via public serializer callers.
    else:
        payload["removed_at"] = row.removed_at
        payload["document_title"] = row.document.title
    return payload


def create_resource(event: Event, payload: dict[str, Any], *, actor) -> EventResource:
    title = sanitize_plain(payload.get("title", ""), max_length=255)
    description = sanitize_plain(payload.get("description", ""), max_length=5000)
    category = str(payload.get("category") or ResourceCategory.OTHER).upper()
    visibility = str(payload.get("visibility") or ResourceVisibility.DRAFT).upper()
    document_id = payload.get("document")
    session_id = payload.get("session")
    errors: dict[str, list[str]] = {}
    if not title:
        errors["title"] = ["Enter a resource title."]
    if category not in ResourceCategory.values:
        errors["category"] = ["Choose a valid category."]
    if visibility not in ResourceVisibility.values:
        errors["visibility"] = ["Choose a valid visibility."]
    if not document_id:
        errors["document"] = ["Select a Site document."]
    if errors:
        raise ValidationError(errors)

    with hierarchy_write(), transaction.atomic():
        document = Document.objects.select_for_update().filter(
            pk=document_id, site_id=event.site_id,
        ).first()
        if document is None:
            raise ValidationError({"document": ["Document was not found on this Site."]})
        try:
            validate_document_file(document.file_reference, event.site_id)
        except ValidationError as error:
            raise ValidationError({
                "document": [
                    "The file is unavailable, still being scanned, quarantined, or belongs to another Site."
                ],
            }) from error

        session = None
        if session_id:
            session = EventSession.objects.filter(
                pk=session_id, event_id=event.pk, removed_at__isnull=True,
            ).first()
            if session is None:
                raise ValidationError({"session": ["Session was not found on this Event."]})

        if active_resources(event).filter(document_id=document.pk).exists():
            raise ResourceConflict("This document is already attached to the Event.")

        sort_order = payload.get("sort_order")
        if sort_order is None:
            latest = active_resources(event).aggregate(m=Max("sort_order"))["m"]
            sort_order = int(latest or 0) + 1

        now = timezone.now()
        row = EventResource(
            event=event,
            site_id=event.site_id,
            session=session,
            document=document,
            title=title,
            description=description,
            category=category,
            sort_order=int(sort_order),
            visibility=visibility,
            published_at=now if visibility != ResourceVisibility.DRAFT else None,
            created_by=actor if getattr(actor, "is_authenticated", False) else None,
            updated_by=actor if getattr(actor, "is_authenticated", False) else None,
        )
        row.save()
        record_event(
            action="EVENT_RESOURCE_CREATED",
            entity_type="cms.event_resource",
            entity_id=row.pk,
            after={"event": str(event.pk), "visibility": row.visibility, "document": str(document.pk)},
            changed_fields=["visibility"],
        )
        return row


def update_resource(event: Event, resource_id, payload: dict[str, Any], *, actor) -> EventResource:
    with hierarchy_write(), transaction.atomic():
        row = active_resources(event).select_for_update().filter(pk=resource_id).first()
        if row is None:
            raise ResourceNotFound("Resource was not found.")
        changed: list[str] = []
        if "title" in payload:
            title = sanitize_plain(payload.get("title", ""), max_length=255)
            if not title:
                raise ValidationError({"title": ["Enter a resource title."]})
            row.title = title
            changed.append("title")
        if "description" in payload:
            row.description = sanitize_plain(payload.get("description", ""), max_length=5000)
            changed.append("description")
        if "category" in payload:
            category = str(payload.get("category") or "").upper()
            if category not in ResourceCategory.values:
                raise ValidationError({"category": ["Choose a valid category."]})
            row.category = category
            changed.append("category")
        if "session" in payload:
            session_id = payload.get("session")
            if session_id in (None, ""):
                row.session = None
            else:
                session = EventSession.objects.filter(
                    pk=session_id, event_id=event.pk, removed_at__isnull=True,
                ).first()
                if session is None:
                    raise ValidationError({"session": ["Session was not found on this Event."]})
                row.session = session
            changed.append("session")
        if "sort_order" in payload:
            row.sort_order = max(0, int(payload["sort_order"]))
            changed.append("sort_order")
        if not changed:
            return row
        row.version += 1
        row.updated_by = actor if getattr(actor, "is_authenticated", False) else None
        row.save()
        record_event(
            action="EVENT_RESOURCE_UPDATED",
            entity_type="cms.event_resource",
            entity_id=row.pk,
            after={field: str(getattr(row, field)) for field in changed},
            changed_fields=changed,
        )
        return row


def set_resource_visibility(event: Event, resource_id, *, visibility: str, actor) -> EventResource:
    visibility = (visibility or "").upper()
    if visibility not in ResourceVisibility.values:
        raise ValidationError({"visibility": ["Choose a valid visibility."]})
    with hierarchy_write(), transaction.atomic():
        row = active_resources(event).select_for_update().filter(pk=resource_id).first()
        if row is None:
            raise ResourceNotFound("Resource was not found.")
        # Re-validate file readiness before publishing.
        if visibility != ResourceVisibility.DRAFT:
            try:
                validate_document_file(row.document.file_reference, event.site_id)
            except ValidationError as error:
                raise ValidationError({
                    "document": ["The file is unavailable, quarantined, or still being scanned."],
                }) from error
        row.visibility = visibility
        if visibility == ResourceVisibility.DRAFT:
            row.published_at = None
        else:
            row.published_at = row.published_at or timezone.now()
        row.version += 1
        row.updated_by = actor if getattr(actor, "is_authenticated", False) else None
        row.save(update_fields=["visibility", "published_at", "version", "updated_by", "updated_at"])
        record_event(
            action="EVENT_RESOURCE_VISIBILITY_CHANGED",
            entity_type="cms.event_resource",
            entity_id=row.pk,
            after={"visibility": row.visibility},
            changed_fields=["visibility"],
        )
        return row


def remove_resource(event: Event, resource_id, *, actor) -> EventResource:
    """Soft-remove the association. Canonical Document is retained."""
    with hierarchy_write(), transaction.atomic():
        row = active_resources(event).select_for_update().filter(pk=resource_id).first()
        if row is None:
            raise ResourceNotFound("Resource was not found.")
        row.removed_at = timezone.now()
        row.visibility = ResourceVisibility.DRAFT
        row.published_at = None
        row.version += 1
        row.updated_by = actor if getattr(actor, "is_authenticated", False) else None
        row.save(update_fields=[
            "removed_at", "visibility", "published_at", "version", "updated_by", "updated_at",
        ])
        record_event(
            action="EVENT_RESOURCE_REMOVED",
            entity_type="cms.event_resource",
            entity_id=row.pk,
            after={"document": str(row.document_id), "retained": True},
            changed_fields=["removed_at"],
        )
        return row


def reorder_resources(event: Event, order: list[UUID], *, actor) -> list[EventResource]:
    with hierarchy_write(), transaction.atomic():
        rows = list(active_resources(event).select_for_update().order_by("sort_order", "id"))
        by_id = {row.pk: row for row in rows}
        if set(order) != set(by_id):
            raise ValidationError({"order": ["Provide every active resource id exactly once."]})
        for index, resource_id in enumerate(order):
            row = by_id[resource_id]
            if row.sort_order != index:
                row.sort_order = index
                row.version += 1
                row.updated_by = actor if getattr(actor, "is_authenticated", False) else None
                row.save(update_fields=["sort_order", "version", "updated_by", "updated_at"])
        return list(active_resources(event).order_by("sort_order", "id"))


def list_admin_resources(event: Event) -> list[dict[str, Any]]:
    rows = active_resources(event).select_related("document", "session", "event").order_by(
        "sort_order", "created_at", "id",
    )
    return [serialize_resource(row, public=False) for row in rows]


def list_public_resources(event: Event) -> list[dict[str, Any]]:
    if event.status != EventStatus.PUBLISHED:
        return []
    rows = (
        active_resources(event)
        .filter(
            visibility__in=[ResourceVisibility.PUBLIC, ResourceVisibility.REGISTERED_ONLY],
            published_at__isnull=False,
        )
        .select_related("document", "session", "event")
        .order_by("sort_order", "created_at", "id")
    )
    # Hide resources whose files are not downloadable (quarantined/missing).
    out = []
    for row in rows:
        payload = serialize_resource(row, public=True)
        if not payload["file_ready"]:
            continue
        out.append(payload)
    return out
