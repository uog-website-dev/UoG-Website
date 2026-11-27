"""Validation, publication actions and ownership helpers for Events."""
from __future__ import annotations

import zoneinfo
from datetime import datetime
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from django.core.exceptions import PermissionDenied, ValidationError
from django.utils import timezone
from django.utils.text import slugify

from apps.audit.context import audit_context, current_audit_context
from apps.audit.writer import record_event
from apps.authorization.access import effective_scope_for_site
from apps.authorization.services import permission_granted
from apps.cms.blocks import Rejection, check_image_ref, sanitize_rich_text
from apps.cms.event_models import Event, EventFormat, EventStatus
from apps.cms.menu_models import validate_external_url
from apps.organizations.hierarchy_lock import hierarchy_write
from apps.sites.events import EVENTS_MODULE_CODE, DEFAULT_EVENT_SETTINGS
from apps.sites.models import Site
from apps.sites.selectors.modules import module_is_available

PUBLISH_REQUIRED = (
    "title", "slug", "summary", "description", "starts_at", "ends_at", "timezone", "format",
)


def require_events_admin(actor, site: Site) -> None:
    if (
        not actor or not actor.is_authenticated or not actor.is_active
        or not permission_granted(
            actor, "sites.update", site_id=site.pk,
            organization_id=effective_scope_for_site(site.pk), audit=False,
        )
    ):
        raise PermissionDenied("A Site Administrator is required to manage Events.")
    if not module_is_available(site.pk, EVENTS_MODULE_CODE):
        raise PermissionDenied("Events are not enabled for this Site.")


def event_etag(event: Event) -> str:
    return f'"site-event-{event.site_id}-{event.pk}-v{event.version}"'


class EventConflict(Exception):
    pass


class EventPreconditionRequired(Exception):
    pass


def _ensure_timezone(name: str) -> str:
    if not isinstance(name, str) or not name.strip():
        raise ValidationError({"timezone": ["Timezone is required."]})
    tz_name = name.strip()
    try:
        zoneinfo.ZoneInfo(tz_name)
    except (zoneinfo.ZoneInfoNotFoundError, KeyError, ValueError) as error:
        raise ValidationError({
            "timezone": [f"Unknown timezone '{tz_name}'. Use an IANA name such as Africa/Addis_Ababa."],
        }) from error
    return tz_name


def _validate_online_url(value: str, *, format_code: str) -> str:
    url = (value or "").strip()
    if format_code in {EventFormat.ONLINE, EventFormat.HYBRID} and not url:
        raise ValidationError({"online_url": ["Enter an https meeting or stream URL."]})
    if not url:
        return ""
    try:
        validate_external_url(url)
    except ValidationError as error:
        raise ValidationError({"online_url": list(getattr(error, "messages", [str(error)]))}) from error
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValidationError({"online_url": ["Only http and https URLs are allowed."]})
    return url


def _validate_banner(asset_id, *, site_id: int):
    if asset_id in (None, ""):
        return None
    if isinstance(asset_id, Event):
        return asset_id
    try:
        asset_uuid = asset_id if isinstance(asset_id, UUID) else UUID(str(asset_id))
    except (TypeError, ValueError, AttributeError) as error:
        raise ValidationError({"banner_asset": ["Choose a Site media image."]}) from error
    from apps.media.models import MediaAsset
    asset = MediaAsset.objects.filter(pk=asset_uuid, site_id=site_id).first()
    if asset is None:
        raise ValidationError({"banner_asset": ["Choose a media image owned by this Site."]})
    if asset.status != "READY" or not str(asset.detected_mime or "").startswith("image/"):
        raise ValidationError({"banner_asset": ["Only a ready image owned by this Site may be selected."]})
    # Reuse the shared image-ref contract as an additional ownership gate.
    try:
        check_image_ref(f"sites/{site_id}/assets/{asset.pk}", site_id=site_id)
    except Rejection as error:
        raise ValidationError({"banner_asset": [str(error)]}) from error
    return asset


def validate_event(event: Event, *, require_publishable: bool = False) -> None:
    errors: dict[str, list[str]] = {}

    title = (event.title or "").strip()
    event.title = title
    if require_publishable and not title:
        errors["title"] = ["Enter an Event title."]

    slug = (event.slug or "").strip().lower()
    if not slug and title:
        slug = slugify(title)[:255]
    event.slug = slug
    if require_publishable and not slug:
        errors["slug"] = ["Enter a URL slug."]
    elif slug and Event.objects.filter(site_id=event.site_id, slug=slug).exclude(pk=event.pk).exists():
        errors["slug"] = ["An Event with this slug already exists in this Site."]

    event.summary = (event.summary or "").strip()
    if require_publishable and not event.summary:
        errors["summary"] = ["Enter a short summary."]
    elif len(event.summary) > 500:
        errors["summary"] = ["Use at most 500 characters."]

    try:
        event.description = sanitize_rich_text(event.description or "")
    except Exception as error:  # nh3 / validation
        errors["description"] = [str(error)]
    if require_publishable and not (event.description or "").strip():
        errors["description"] = ["Enter an Event description."]

    if event.category_id:
        from apps.api.models import Category
        category = Category.objects.filter(
            pk=event.category_id, site_id=event.site_id, kind=Category.Kind.EVENTS,
        ).first()
        if category is None:
            errors["category"] = ["Choose an Event category belonging to this Site."]
        elif require_publishable and not category.is_active:
            errors["category"] = ["Choose an active Event category."]

    event.organizer_name = (event.organizer_name or "").strip()
    event.organizer_email = (event.organizer_email or "").strip()
    event.organizer_phone = (event.organizer_phone or "").strip()

    if event.timezone:
        try:
            event.timezone = _ensure_timezone(event.timezone)
        except ValidationError as error:
            errors.update(error.message_dict)
    elif require_publishable:
        errors["timezone"] = ["Timezone is required."]

    if event.starts_at and event.ends_at:
        if event.ends_at <= event.starts_at:
            errors["ends_at"] = ["End must be after the start date and time."]
    elif require_publishable:
        if not event.starts_at:
            errors["starts_at"] = ["Enter a start date and time."]
        if not event.ends_at:
            errors["ends_at"] = ["Enter an end date and time."]

    if event.format not in EventFormat.values:
        errors["format"] = ["Choose physical, online or hybrid."]
    try:
        event.online_url = _validate_online_url(event.online_url, format_code=event.format)
    except ValidationError as error:
        errors.update(error.message_dict)

    event.venue = (event.venue or "").strip()
    if require_publishable and event.format in {EventFormat.PHYSICAL, EventFormat.HYBRID} and not event.venue:
        errors["venue"] = ["Enter a venue for physical or hybrid Events."]

    if event.registration_capacity is not None and event.registration_capacity < 1:
        errors["registration_capacity"] = ["Capacity must be at least 1 when set."]

    if event.banner_asset_id:
        try:
            event.banner_asset = _validate_banner(event.banner_asset_id, site_id=event.site_id)
        except ValidationError as error:
            errors.update(error.message_dict)

    if event.status == EventStatus.CANCELLED and require_publishable:
        # Publishing a cancelled Event is not a valid path; callers use cancel().
        pass

    if errors:
        raise ValidationError(errors)


def apply_event_defaults(event: Event, site: Site) -> None:
    from apps.sites.events import ensure_event_settings
    settings_obj = ensure_event_settings(site)
    if not event.timezone:
        event.timezone = settings_obj.timezone or DEFAULT_EVENT_SETTINGS["timezone"]
    if event._state.adding:
        event.registration_required = settings_obj.registration_required_by_default
        event.registration_capacity = settings_obj.registration_default_capacity


def create_event(site: Site, payload: dict[str, Any], *, actor) -> Event:
    require_events_admin(actor, site)
    event = Event(site=site, created_by=actor, updated_by=actor)
    apply_event_defaults(event, site)
    _assign_fields(event, payload, site_id=site.pk)
    with hierarchy_write():
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id):
            event.save()
            record_event(
                action="EVENT_CREATED", entity_type="cms.event", entity_id=event.pk,
                after=_snapshot(event), changed_fields=sorted(_snapshot(event)),
            )
    return event


def update_event(event: Event, payload: dict[str, Any], *, actor, expected: str | None) -> Event:
    require_events_admin(actor, event.site)
    if not expected:
        raise EventPreconditionRequired()
    if expected != event_etag(event):
        raise EventConflict()
    before = _snapshot(event)
    _assign_fields(event, payload, site_id=event.site_id)
    event.updated_by = actor
    with hierarchy_write():
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id):
            event.save()
            after = _snapshot(event)
            changed = [key for key in after if before.get(key) != after[key]]
            if changed:
                record_event(
                    action="EVENT_UPDATED", entity_type="cms.event", entity_id=event.pk,
                    before=before, after=after, changed_fields=changed,
                )
    return event


def publish_event(event: Event, *, actor, expected: str | None) -> Event:
    require_events_admin(actor, event.site)
    if not expected:
        raise EventPreconditionRequired()
    if expected != event_etag(event):
        raise EventConflict()
    if event.status == EventStatus.ARCHIVED:
        raise ValidationError({"status": ["Archived Events cannot be published."]})
    validate_event(event, require_publishable=True)
    from apps.cms.event_session_domain import assert_publishable_schedule
    assert_publishable_schedule(event)
    before = _snapshot(event)
    event.status = EventStatus.PUBLISHED
    event.registration_open = True
    event.cancellation_notice = ""
    event.cancelled_at = None
    if event.published_at is None:
        event.published_at = timezone.now()
    event.updated_by = actor
    with hierarchy_write():
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id):
            event.save()
            after = _snapshot(event)
            record_event(
                action="EVENT_PUBLISHED", entity_type="cms.event", entity_id=event.pk,
                before=before, after=after, changed_fields=["status"],
            )
    return event


def cancel_event(event: Event, *, actor, expected: str | None, notice: str = "") -> Event:
    require_events_admin(actor, event.site)
    if not expected:
        raise EventPreconditionRequired()
    if expected != event_etag(event):
        raise EventConflict()
    if event.status not in {EventStatus.PUBLISHED, EventStatus.CANCELLED}:
        raise ValidationError({"status": ["Only published Events can be cancelled."]})
    before = _snapshot(event)
    event.status = EventStatus.CANCELLED
    event.registration_open = False
    event.cancellation_notice = (notice or "This Event has been cancelled.").strip()
    event.cancelled_at = timezone.now()
    event.updated_by = actor
    with hierarchy_write():
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id):
            event.save()
            after = _snapshot(event)
            record_event(
                action="EVENT_CANCELLED", entity_type="cms.event", entity_id=event.pk,
                before=before, after=after, changed_fields=["status", "registration_open"],
            )
    return event


def archive_event(event: Event, *, actor, expected: str | None) -> Event:
    require_events_admin(actor, event.site)
    if not expected:
        raise EventPreconditionRequired()
    if expected != event_etag(event):
        raise EventConflict()
    before = _snapshot(event)
    event.status = EventStatus.ARCHIVED
    event.registration_open = False
    event.updated_by = actor
    with hierarchy_write():
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id):
            event.save()
            after = _snapshot(event)
            record_event(
                action="EVENT_ARCHIVED", entity_type="cms.event", entity_id=event.pk,
                before=before, after=after, changed_fields=["status"],
            )
    return event


def duplicate_event(event: Event, *, actor) -> Event:
    require_events_admin(actor, event.site)
    payload = {
        "title": f"{event.title} (Copy)" if event.title else "Untitled Event (Copy)",
        "summary": event.summary,
        "description": event.description,
        "category": event.category_id,
        "organizer_name": event.organizer_name,
        "organizer_email": event.organizer_email,
        "organizer_phone": event.organizer_phone,
        "starts_at": event.starts_at,
        "ends_at": event.ends_at,
        "timezone": event.timezone,
        "venue": event.venue,
        "format": event.format,
        "online_url": event.online_url,
        "banner_asset": event.banner_asset_id,
        "registration_required": event.registration_required,
        "registration_capacity": event.registration_capacity,
    }
    return create_event(event.site, payload, actor=actor)


def public_events_queryset(site_id: int):
    return Event.objects.filter(
        site_id=site_id,
        status__in=[EventStatus.PUBLISHED, EventStatus.CANCELLED],
    )


def _assign_fields(event: Event, payload: dict[str, Any], *, site_id: int) -> None:
    mapping = {
        "title": "title",
        "slug": "slug",
        "summary": "summary",
        "description": "description",
        "organizer_name": "organizer_name",
        "organizer_email": "organizer_email",
        "organizer_phone": "organizer_phone",
        "venue": "venue",
        "format": "format",
        "online_url": "online_url",
        "timezone": "timezone",
        "registration_required": "registration_required",
        "registration_open": "registration_open",
        "cancellation_notice": "cancellation_notice",
    }
    for key, attr in mapping.items():
        if key in payload:
            setattr(event, attr, payload[key])
    if "starts_at" in payload:
        event.starts_at = _parse_datetime(payload["starts_at"], field="starts_at")
    if "ends_at" in payload:
        event.ends_at = _parse_datetime(payload["ends_at"], field="ends_at")
    if "registration_capacity" in payload:
        capacity = payload["registration_capacity"]
        event.registration_capacity = None if capacity in ("", None) else capacity
    if "category" in payload:
        category = payload["category"]
        event.category_id = None if category in ("", None) else category
    if "banner_asset" in payload:
        banner = payload["banner_asset"]
        if banner in ("", None):
            event.banner_asset = None
            event.banner_asset_id = None
        else:
            event.banner_asset = _validate_banner(banner, site_id=site_id)


def _parse_datetime(value, *, field: str):
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value if timezone.is_aware(value) else timezone.make_aware(value, timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValidationError({field: ["Enter an ISO-8601 date and time."]}) from error
        if timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed, timezone.utc)
        return parsed
    raise ValidationError({field: ["Enter an ISO-8601 date and time."]})


def _snapshot(event: Event) -> dict[str, Any]:
    return {
        "title": event.title,
        "slug": event.slug,
        "summary": event.summary,
        "status": event.status,
        "starts_at": event.starts_at.isoformat() if event.starts_at else None,
        "ends_at": event.ends_at.isoformat() if event.ends_at else None,
        "timezone": event.timezone,
        "format": event.format,
        "venue": event.venue,
        "online_url": event.online_url,
        "category_id": str(event.category_id) if event.category_id else None,
        "banner_asset_id": str(event.banner_asset_id) if event.banner_asset_id else None,
        "registration_required": event.registration_required,
        "registration_capacity": event.registration_capacity,
        "registration_open": event.registration_open,
        "cancellation_notice": event.cancellation_notice,
    }
