"""Create, publish and list Event gallery associations without deleting Media."""
from __future__ import annotations

from typing import Any
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from django.utils.html import strip_tags

from apps.audit.writer import record_event
from apps.cms.blocks import Rejection, check_image_ref
from apps.cms.event_gallery_models import EventGalleryImage
from apps.cms.event_models import Event, EventStatus
from apps.cms.event_session_models import EventSession
from apps.media.models import MediaAsset
from apps.media.selectors import READY_IMAGE_TYPES
from apps.organizations.hierarchy_lock import hierarchy_write


class GalleryConflict(Exception):
    pass


class GalleryNotFound(Exception):
    pass


class GalleryPreconditionRequired(Exception):
    pass


def sanitize_plain(value: str, *, max_length: int) -> str:
    return strip_tags(value or "").replace("\x00", "").strip()[:max_length]


def active_gallery(event: Event):
    return EventGalleryImage.objects.filter(event_id=event.pk, removed_at__isnull=True)


def public_gallery_available(event: Event) -> bool:
    if event.status != EventStatus.PUBLISHED:
        return False
    return active_gallery(event).filter(is_published=True, published_at__isnull=False).exists()


def _validate_gallery_asset(asset_id, *, site_id: int) -> MediaAsset:
    try:
        asset_uuid = asset_id if isinstance(asset_id, UUID) else UUID(str(asset_id))
    except (TypeError, ValueError, AttributeError) as error:
        raise ValidationError({"media_asset": ["Choose a Site media image."]}) from error
    asset = MediaAsset.objects.filter(pk=asset_uuid, site_id=site_id, deleted_at__isnull=True).first()
    if asset is None:
        raise ValidationError({"media_asset": ["Choose a media image owned by this Site."]})
    if asset.status != MediaAsset.Status.READY or asset.detected_mime not in READY_IMAGE_TYPES:
        raise ValidationError({
            "media_asset": ["Only a ready image owned by this Site may be selected."],
        })
    processing_state = getattr(getattr(asset, "processing", None), "state", None)
    if processing_state != "READY":
        raise ValidationError({
            "media_asset": ["Wait for the security scan to finish before adding this image."],
        })
    try:
        check_image_ref(f"sites/{site_id}/assets/{asset.pk}", site_id=site_id)
    except Rejection as error:
        raise ValidationError({"media_asset": [str(error)]}) from error
    return asset


def _image_urls(asset: MediaAsset, *, site_id: int, public: bool) -> dict[str, str]:
    if public:
        base = f"/api/v1/site-context/media/{asset.pk}/"
    else:
        base = f"/api/v1/sites/{site_id}/assets/{asset.pk}/image/"
    return {
        "thumbnail_url": f"{base}?variant=thumbnail",
        "display_url": f"{base}?variant=display",
    }


def serialize_gallery_image(row: EventGalleryImage, *, public: bool = False) -> dict[str, Any]:
    asset = row.media_asset
    urls = _image_urls(asset, site_id=row.site_id, public=public)
    alt = (row.alt_text or asset.alt_text or "").strip()
    payload = {
        "id": row.pk,
        "event": row.event_id,
        "session": row.session_id,
        "session_title": row.session.title if row.session_id and getattr(row, "session", None) else None,
        "caption": row.caption,
        "alt_text": alt,
        "sort_order": row.sort_order,
        "is_published": row.is_published,
        "published_at": row.published_at,
        "version": row.version,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        **urls,
    }
    if public:
        return payload
    payload.update({
        "media_asset": asset.pk,
        "original_filename": asset.original_filename,
        "content_type": asset.detected_mime,
        "byte_count": asset.byte_count,
        "width": asset.width,
        "height": asset.height,
        "usage_consent": row.usage_consent,
        "asset_ready": (
            asset.status == MediaAsset.Status.READY
            and asset.detected_mime in READY_IMAGE_TYPES
            and getattr(getattr(asset, "processing", None), "state", None) == "READY"
        ),
        "removed_at": row.removed_at,
    })
    return payload


def create_gallery_images(event: Event, items: list[dict[str, Any]], *, actor) -> list[EventGalleryImage]:
    if not items:
        raise ValidationError({"items": ["Select at least one image."]})
    created: list[EventGalleryImage] = []
    with hierarchy_write(), transaction.atomic():
        latest = active_gallery(event).aggregate(m=Max("sort_order"))["m"]
        next_order = int(latest or -1) + 1
        for item in items:
            asset = _validate_gallery_asset(item.get("media_asset"), site_id=event.site_id)
            if active_gallery(event).filter(media_asset_id=asset.pk).exists():
                raise GalleryConflict(f"Image {asset.pk} is already in this Event gallery.")
            if not bool(item.get("usage_consent")):
                raise ValidationError({
                    "usage_consent": ["Confirm media usage and consent policy before attaching."],
                })
            session = None
            session_id = item.get("session")
            if session_id:
                session = EventSession.objects.filter(
                    pk=session_id, event_id=event.pk, removed_at__isnull=True,
                ).first()
                if session is None:
                    raise ValidationError({"session": ["Session was not found on this Event."]})
            caption = sanitize_plain(item.get("caption", ""), max_length=500)
            alt_text = sanitize_plain(
                item.get("alt_text") or asset.alt_text or asset.original_filename or "Event photo",
                max_length=255,
            )
            publish = bool(item.get("is_published"))
            if publish and not alt_text:
                raise ValidationError({"alt_text": ["Enter alt text before publishing."]})
            if publish:
                # Re-validate readiness at publish time.
                _validate_gallery_asset(asset.pk, site_id=event.site_id)
            now = timezone.now()
            row = EventGalleryImage(
                event=event,
                site_id=event.site_id,
                media_asset=asset,
                session=session,
                caption=caption,
                alt_text=alt_text,
                sort_order=next_order,
                is_published=publish,
                usage_consent=True,
                published_at=now if publish else None,
                created_by=actor if getattr(actor, "is_authenticated", False) else None,
                updated_by=actor if getattr(actor, "is_authenticated", False) else None,
            )
            row.save()
            next_order += 1
            created.append(row)
            record_event(
                action="EVENT_GALLERY_IMAGE_CREATED",
                entity_type="cms.event_gallery_image",
                entity_id=row.pk,
                after={"event": str(event.pk), "media_asset": str(asset.pk), "is_published": row.is_published},
                changed_fields=["is_published"],
            )
    return created


def update_gallery_image(
    event: Event, image_id, payload: dict[str, Any], *, actor, expected_version: int | None = None,
) -> EventGalleryImage:
    with hierarchy_write(), transaction.atomic():
        row = active_gallery(event).select_for_update().select_related("media_asset").filter(pk=image_id).first()
        if row is None:
            raise GalleryNotFound("Gallery image was not found.")
        if expected_version is not None and row.version != expected_version:
            raise GalleryConflict("Gallery image was modified by another editor.")
        changed: list[str] = []
        if "caption" in payload:
            row.caption = sanitize_plain(payload.get("caption", ""), max_length=500)
            changed.append("caption")
        if "alt_text" in payload:
            alt = sanitize_plain(payload.get("alt_text", ""), max_length=255)
            if row.is_published and not alt:
                raise ValidationError({"alt_text": ["Published images require alt text."]})
            row.alt_text = alt
            changed.append("alt_text")
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
            action="EVENT_GALLERY_IMAGE_UPDATED",
            entity_type="cms.event_gallery_image",
            entity_id=row.pk,
            after={field: str(getattr(row, field)) for field in changed},
            changed_fields=changed,
        )
        return row


def set_gallery_published(
    event: Event, image_id, *, is_published: bool, actor, expected_version: int | None = None,
) -> EventGalleryImage:
    with hierarchy_write(), transaction.atomic():
        row = active_gallery(event).select_for_update().select_related("media_asset").filter(pk=image_id).first()
        if row is None:
            raise GalleryNotFound("Gallery image was not found.")
        if expected_version is not None and row.version != expected_version:
            raise GalleryConflict("Gallery image was modified by another editor.")
        if is_published:
            _validate_gallery_asset(row.media_asset_id, site_id=event.site_id)
            if not (row.alt_text or "").strip():
                raise ValidationError({"alt_text": ["Enter alt text before publishing."]})
            if not row.usage_consent:
                raise ValidationError({"usage_consent": ["Confirm media usage consent before publishing."]})
            row.is_published = True
            row.published_at = row.published_at or timezone.now()
        else:
            row.is_published = False
            row.published_at = None
        row.version += 1
        row.updated_by = actor if getattr(actor, "is_authenticated", False) else None
        row.save(update_fields=[
            "is_published", "published_at", "version", "updated_by", "updated_at",
        ])
        record_event(
            action="EVENT_GALLERY_IMAGE_VISIBILITY_CHANGED",
            entity_type="cms.event_gallery_image",
            entity_id=row.pk,
            after={"is_published": row.is_published},
            changed_fields=["is_published"],
        )
        return row


def detach_gallery_image(event: Event, image_id, *, actor) -> EventGalleryImage:
    """Detach association only; canonical MediaAsset is retained."""
    with hierarchy_write(), transaction.atomic():
        row = active_gallery(event).select_for_update().filter(pk=image_id).first()
        if row is None:
            raise GalleryNotFound("Gallery image was not found.")
        asset_id = row.media_asset_id
        row.removed_at = timezone.now()
        row.is_published = False
        row.published_at = None
        row.version += 1
        row.updated_by = actor if getattr(actor, "is_authenticated", False) else None
        row.save(update_fields=[
            "removed_at", "is_published", "published_at", "version", "updated_by", "updated_at",
        ])
        record_event(
            action="EVENT_GALLERY_IMAGE_DETACHED",
            entity_type="cms.event_gallery_image",
            entity_id=row.pk,
            after={"media_asset": str(asset_id), "retained": True},
            changed_fields=["removed_at"],
        )
        return row


def reorder_gallery(
    event: Event, order: list[UUID], *, actor, expected_versions: dict[str, int] | None = None,
) -> list[EventGalleryImage]:
    with hierarchy_write(), transaction.atomic():
        rows = list(active_gallery(event).select_for_update().order_by("sort_order", "id"))
        by_id = {row.pk: row for row in rows}
        if set(order) != set(by_id):
            raise ValidationError({"order": ["Provide every active gallery image id exactly once."]})
        if expected_versions:
            for resource_id, version in expected_versions.items():
                try:
                    key = UUID(str(resource_id))
                except (TypeError, ValueError):
                    raise ValidationError({"versions": ["Invalid gallery image id in versions."]}) from None
                row = by_id.get(key)
                if row is None or row.version != int(version):
                    raise GalleryConflict("Gallery order is out of date. Refresh and try again.")
        for index, image_id in enumerate(order):
            row = by_id[image_id]
            if row.sort_order != index:
                row.sort_order = index
                row.version += 1
                row.updated_by = actor if getattr(actor, "is_authenticated", False) else None
                row.save(update_fields=["sort_order", "version", "updated_by", "updated_at"])
        record_event(
            action="EVENT_GALLERY_REORDERED",
            entity_type="cms.event",
            entity_id=event.pk,
            after={"count": len(order)},
            changed_fields=["sort_order"],
        )
        return list(active_gallery(event).select_related("media_asset", "session").order_by("sort_order", "id"))


def list_admin_gallery(event: Event) -> list[dict[str, Any]]:
    rows = active_gallery(event).select_related("media_asset", "session").order_by(
        "sort_order", "created_at", "id",
    )
    return [serialize_gallery_image(row, public=False) for row in rows]


def list_public_gallery(event: Event) -> list[dict[str, Any]]:
    if event.status != EventStatus.PUBLISHED:
        return []
    rows = (
        active_gallery(event)
        .filter(is_published=True, published_at__isnull=False)
        .select_related("media_asset", "session")
        .order_by("sort_order", "created_at", "id")
    )
    out = []
    for row in rows:
        asset = row.media_asset
        if (
            asset.deleted_at is not None
            or asset.status != MediaAsset.Status.READY
            or asset.detected_mime not in READY_IMAGE_TYPES
            or getattr(getattr(asset, "processing", None), "state", None) != "READY"
        ):
            continue
        out.append(serialize_gallery_image(row, public=True))
    return out
