"""Domain helpers for Site Staff Directory settings and organization scope."""
from __future__ import annotations

from typing import Any

from django.core.exceptions import PermissionDenied, ValidationError

from apps.audit.context import audit_context, current_audit_context
from apps.authorization.access import effective_scope_for_site, organization_ids_in_scope
from apps.authorization.services import permission_granted
from apps.cms.menu_models import CUSTOM_PATH
from apps.organizations.hierarchy_lock import hierarchy_write
from apps.sites.models.site import Site
from apps.sites.models.staff_directory_settings import (
    STAFF_DIRECTORY_SETTINGS_FIELDS,
    SiteStaffDirectorySettings,
    StaffDirectoryPresentation,
    StaffDirectorySort,
)
from apps.sites.selectors.modules import available_module_codes, module_is_available

STAFF_DIRECTORY_MODULE_CODE = "STAFF_DIRECTORY"

DEFAULT_STAFF_DIRECTORY_SETTINGS: dict[str, Any] = {
    "page_size": 20,
    "default_sort": StaffDirectorySort.NAME_ASC,
    "public_list_path": "/staff",
    "presentation": StaffDirectoryPresentation.LIST,
    "public_aggregation_eligible": False,
}

PAGE_SIZE_MIN = 5
PAGE_SIZE_MAX = 100


def ensure_staff_directory_settings(site: Site) -> SiteStaffDirectorySettings:
    settings_obj, _ = SiteStaffDirectorySettings.objects.get_or_create(site=site)
    return settings_obj


def staff_directory_settings_values(row: SiteStaffDirectorySettings | None) -> dict[str, Any]:
    if row is None:
        return dict(DEFAULT_STAFF_DIRECTORY_SETTINGS)
    return {field: getattr(row, field) for field in STAFF_DIRECTORY_SETTINGS_FIELDS}


def get_staff_directory_settings_payload(settings_obj: SiteStaffDirectorySettings | None) -> dict[str, Any]:
    values = staff_directory_settings_values(settings_obj)
    return {
        **values,
        "version": settings_obj.version if settings_obj else 0,
        "updated_at": (
            settings_obj.updated_at.isoformat()
            if settings_obj and settings_obj.updated_at
            else None
        ),
    }


def public_staff_directory_settings_payload(site: Site) -> dict[str, Any] | None:
    """Public subset when STAFF_DIRECTORY is available; else None (hide public nav)."""
    if not module_is_available(site.pk, STAFF_DIRECTORY_MODULE_CODE):
        return None
    settings_obj = getattr(site, "staff_directory_settings", None)
    if settings_obj is None:
        try:
            settings_obj = SiteStaffDirectorySettings.objects.get(site=site)
        except SiteStaffDirectorySettings.DoesNotExist:
            return dict(DEFAULT_STAFF_DIRECTORY_SETTINGS)
    return staff_directory_settings_values(settings_obj)


def normalize_public_list_path(value: str) -> str:
    path = (value or "").strip()
    if not path.startswith("/"):
        path = f"/{path}"
    path = path.rstrip("/") or "/"
    if path != "/" and path.endswith("/"):
        path = path[:-1]
    return path


def validate_staff_directory_settings(payload: dict[str, Any]) -> dict[str, Any]:
    errors: dict[str, list[str]] = {}
    cleaned: dict[str, Any] = {}

    page_size = payload.get("page_size", DEFAULT_STAFF_DIRECTORY_SETTINGS["page_size"])
    if isinstance(page_size, bool) or not isinstance(page_size, int):
        errors["page_size"] = [f"Must be an integer between {PAGE_SIZE_MIN} and {PAGE_SIZE_MAX}."]
    elif page_size < PAGE_SIZE_MIN or page_size > PAGE_SIZE_MAX:
        errors["page_size"] = [f"Must be between {PAGE_SIZE_MIN} and {PAGE_SIZE_MAX}."]
    else:
        cleaned["page_size"] = page_size

    sort = payload.get("default_sort", DEFAULT_STAFF_DIRECTORY_SETTINGS["default_sort"])
    if sort not in StaffDirectorySort.values:
        errors["default_sort"] = ["Choose a supported directory sort order."]
    else:
        cleaned["default_sort"] = sort

    path_raw = payload.get("public_list_path", DEFAULT_STAFF_DIRECTORY_SETTINGS["public_list_path"])
    if not isinstance(path_raw, str) or not path_raw.strip():
        errors["public_list_path"] = ["Public directory route is required."]
    elif not path_raw.strip().startswith("/"):
        errors["public_list_path"] = [
            "Use a lowercase same-site path such as /staff or /about/staff.",
        ]
    else:
        path = normalize_public_list_path(path_raw)
        if path == "/":
            errors["public_list_path"] = ["Choose a dedicated public directory path such as /staff."]
        elif not CUSTOM_PATH.match(path):
            errors["public_list_path"] = [
                "Use a lowercase same-site path such as /staff or /about/staff.",
            ]
        else:
            cleaned["public_list_path"] = path

    presentation = payload.get("presentation", DEFAULT_STAFF_DIRECTORY_SETTINGS["presentation"])
    if presentation not in StaffDirectoryPresentation.values:
        errors["presentation"] = ["Choose list or cards presentation."]
    else:
        cleaned["presentation"] = presentation

    eligible = payload.get(
        "public_aggregation_eligible",
        DEFAULT_STAFF_DIRECTORY_SETTINGS["public_aggregation_eligible"],
    )
    if not isinstance(eligible, bool):
        errors["public_aggregation_eligible"] = ["Must be true or false."]
    else:
        cleaned["public_aggregation_eligible"] = eligible

    if errors:
        raise ValidationError(errors)
    return cleaned


def staff_directory_settings_etag(site_id: int, row: SiteStaffDirectorySettings | None) -> str:
    return f'"site-staff-directory-{site_id}-v{row.version if row else 0}"'


class StaffDirectorySettingsPreconditionRequired(Exception):
    pass


class StaffDirectorySettingsConflict(Exception):
    pass


def _require_site_admin(actor, site: Site) -> None:
    if (
        not actor
        or not actor.is_authenticated
        or not actor.is_active
        or not permission_granted(
            actor,
            "sites.update",
            site_id=site.pk,
            organization_id=effective_scope_for_site(site.pk),
            audit=False,
        )
    ):
        raise PermissionDenied("Site settings permission is required.")


def require_staff_directory_module(site: Site) -> None:
    if not module_is_available(site.pk, STAFF_DIRECTORY_MODULE_CODE):
        raise PermissionDenied("Staff Directory is not enabled for this Site.")


def resolve_directory_organization_scope(site: Site) -> dict[str, Any]:
    """Resolve authorized organizational scope for this Site's directory.

    Never trusts a client-supplied Site or Organization ID. College Sites
    always use the mapped Organization plus descendants. University Main may
    additionally surface eligible child Sites when those Sites opted in.
    """
    org_id = site.organization_unit_id
    organization_ids = organization_ids_in_scope(org_id) if org_id else []
    payload: dict[str, Any] = {
        "organization_unit_id": org_id,
        "organization_ids": organization_ids,
        "mode": "mapped_organization",
        "aggregation_site_ids": [],
    }
    if not getattr(site, "is_main", False):
        return payload

    eligible_ids = list(
        SiteStaffDirectorySettings.objects.filter(public_aggregation_eligible=True)
        .exclude(site_id=site.pk)
        .values_list("site_id", flat=True)
    )
    aggregation_site_ids = [
        sid for sid in eligible_ids if STAFF_DIRECTORY_MODULE_CODE in available_module_codes(sid)
    ]
    payload["mode"] = "main_with_eligible_aggregation" if aggregation_site_ids else "mapped_organization"
    payload["aggregation_site_ids"] = aggregation_site_ids
    return payload


def save_staff_directory_settings(
    site_id: int,
    changes: dict[str, Any],
    *,
    actor,
    expected: str | None,
) -> SiteStaffDirectorySettings:
    if set(changes) - set(STAFF_DIRECTORY_SETTINGS_FIELDS):
        raise ValidationError({"fields": "Unsupported staff directory settings fields."})
    with hierarchy_write():
        site = Site.objects.select_for_update().get(pk=site_id)
        _require_site_admin(actor, site)
        require_staff_directory_module(site)
        row = SiteStaffDirectorySettings.objects.select_for_update().filter(site=site).first()
        if not expected:
            raise StaffDirectorySettingsPreconditionRequired()
        if expected != staff_directory_settings_etag(site.pk, row):
            raise StaffDirectorySettingsConflict()
        values = {**staff_directory_settings_values(row), **changes}
        cleaned = validate_staff_directory_settings(values)
        if row and cleaned == staff_directory_settings_values(row):
            return row
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id):
            if row is None:
                row = SiteStaffDirectorySettings(site=site, created_by=actor)
            for field, value in cleaned.items():
                setattr(row, field, value)
            row.updated_by = actor
            row.save()
        return row
