"""Domain helpers for Site Event Management settings."""
from __future__ import annotations

import zoneinfo
from typing import Any

from django.core.exceptions import PermissionDenied, ValidationError

from apps.audit.context import audit_context, current_audit_context
from apps.authorization.access import effective_scope_for_site
from apps.authorization.services import permission_granted
from apps.cms.menu_models import CUSTOM_PATH
from apps.organizations.hierarchy_lock import hierarchy_write
from apps.sites.models.event_settings import EVENT_SETTINGS_FIELDS, SiteEventSettings
from apps.sites.models.site import Site
from apps.sites.selectors.modules import module_is_available

EVENTS_MODULE_CODE = "EVENTS"

DEFAULT_EVENT_SETTINGS: dict[str, Any] = {
    "timezone": "Africa/Addis_Ababa",
    "public_list_path": "/events",
    "registration_required_by_default": False,
    "registration_default_capacity": None,
    "public_aggregation_eligible": False,
}


def ensure_event_settings(site: Site) -> SiteEventSettings:
    settings_obj, _ = SiteEventSettings.objects.get_or_create(site=site)
    return settings_obj


def event_settings_values(row: SiteEventSettings | None) -> dict[str, Any]:
    if row is None:
        return dict(DEFAULT_EVENT_SETTINGS)
    return {field: getattr(row, field) for field in EVENT_SETTINGS_FIELDS}


def get_event_settings_payload(settings_obj: SiteEventSettings | None) -> dict[str, Any]:
    values = event_settings_values(settings_obj)
    return {
        **values,
        "version": settings_obj.version if settings_obj else 0,
        "updated_at": settings_obj.updated_at.isoformat() if settings_obj and settings_obj.updated_at else None,
    }


def public_event_settings_payload(site: Site) -> dict[str, Any] | None:
    """Public subset when EVENTS is available for the Site; else None."""
    if not module_is_available(site.pk, EVENTS_MODULE_CODE):
        return None
    settings_obj = getattr(site, "event_settings", None)
    if settings_obj is None:
        try:
            settings_obj = SiteEventSettings.objects.get(site=site)
        except SiteEventSettings.DoesNotExist:
            return dict(DEFAULT_EVENT_SETTINGS)
    return event_settings_values(settings_obj)


def normalize_public_list_path(value: str) -> str:
    path = (value or "").strip()
    if not path.startswith("/"):
        path = f"/{path}"
    path = path.rstrip("/") or "/"
    if path != "/" and path.endswith("/"):
        path = path[:-1]
    return path


def validate_event_settings(payload: dict[str, Any]) -> dict[str, Any]:
    errors: dict[str, list[str]] = {}
    cleaned: dict[str, Any] = {}

    timezone = payload.get("timezone", DEFAULT_EVENT_SETTINGS["timezone"])
    if not isinstance(timezone, str) or not timezone.strip():
        errors["timezone"] = ["Timezone is required."]
    else:
        tz_name = timezone.strip()
        try:
            zoneinfo.ZoneInfo(tz_name)
        except (zoneinfo.ZoneInfoNotFoundError, KeyError, ValueError):
            errors["timezone"] = [
                f"Unknown timezone '{tz_name}'. Use an IANA name such as Africa/Addis_Ababa.",
            ]
        else:
            cleaned["timezone"] = tz_name

    path_raw = payload.get("public_list_path", DEFAULT_EVENT_SETTINGS["public_list_path"])
    if not isinstance(path_raw, str) or not path_raw.strip():
        errors["public_list_path"] = ["Public list route is required."]
    elif not path_raw.strip().startswith("/"):
        errors["public_list_path"] = [
            "Use a lowercase same-site path such as /events or /campus/events.",
        ]
    else:
        path = normalize_public_list_path(path_raw)
        if path == "/":
            errors["public_list_path"] = ["Choose a dedicated public list path such as /events."]
        elif not CUSTOM_PATH.match(path):
            errors["public_list_path"] = [
                "Use a lowercase same-site path such as /events or /campus/events.",
            ]
        else:
            cleaned["public_list_path"] = path

    reg_required = payload.get(
        "registration_required_by_default",
        DEFAULT_EVENT_SETTINGS["registration_required_by_default"],
    )
    if not isinstance(reg_required, bool):
        errors["registration_required_by_default"] = ["Must be true or false."]
    else:
        cleaned["registration_required_by_default"] = reg_required

    capacity = payload.get(
        "registration_default_capacity",
        DEFAULT_EVENT_SETTINGS["registration_default_capacity"],
    )
    if capacity is None or capacity == "":
        cleaned["registration_default_capacity"] = None
    elif isinstance(capacity, bool) or not isinstance(capacity, int):
        errors["registration_default_capacity"] = ["Must be a positive integer or null."]
    elif capacity < 1:
        errors["registration_default_capacity"] = ["Must be at least 1 when set."]
    else:
        cleaned["registration_default_capacity"] = capacity

    eligible = payload.get(
        "public_aggregation_eligible",
        DEFAULT_EVENT_SETTINGS["public_aggregation_eligible"],
    )
    if not isinstance(eligible, bool):
        errors["public_aggregation_eligible"] = ["Must be true or false."]
    else:
        cleaned["public_aggregation_eligible"] = eligible

    if errors:
        raise ValidationError(errors)
    return cleaned


def event_settings_etag(site_id: int, row: SiteEventSettings | None) -> str:
    return f'"site-events-{site_id}-v{row.version if row else 0}"'


class EventSettingsPreconditionRequired(Exception):
    pass


class EventSettingsConflict(Exception):
    pass


def _require_site_admin(actor, site: Site) -> None:
    if (
        not actor or not actor.is_authenticated or not actor.is_active
        or not permission_granted(
            actor, "sites.update", site_id=site.pk,
            organization_id=effective_scope_for_site(site.pk), audit=False,
        )
    ):
        raise PermissionDenied("Site settings permission is required.")


def require_events_module(site: Site) -> None:
    if not module_is_available(site.pk, EVENTS_MODULE_CODE):
        raise PermissionDenied("Events are not enabled for this Site.")


def events_write_allowed(site: Site) -> bool:
    """True when Event write APIs may proceed for this Site."""
    return module_is_available(site.pk, EVENTS_MODULE_CODE)


def save_event_settings(site_id: int, changes: dict[str, Any], *, actor, expected: str | None) -> SiteEventSettings:
    if set(changes) - set(EVENT_SETTINGS_FIELDS):
        raise ValidationError({"fields": "Unsupported event settings fields."})
    with hierarchy_write():
        site = Site.objects.select_for_update().get(pk=site_id)
        _require_site_admin(actor, site)
        require_events_module(site)
        row = SiteEventSettings.objects.select_for_update().filter(site=site).first()
        if not expected:
            raise EventSettingsPreconditionRequired()
        if expected != event_settings_etag(site.pk, row):
            raise EventSettingsConflict()
        values = {**event_settings_values(row), **changes}
        cleaned = validate_event_settings(values)
        if row and cleaned == event_settings_values(row):
            return row
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id):
            if row is None:
                row = SiteEventSettings(site=site, created_by=actor)
            for field, value in cleaned.items():
                setattr(row, field, value)
            row.updated_by = actor
            row.save()
        return row
