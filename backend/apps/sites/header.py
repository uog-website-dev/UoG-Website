"""Typed header settings with a draft/publication split.

Navigation is deliberately absent: header and utility menus come from the
Site's existing published menu locations, so this module only owns typed
presentation settings. Draft values publish separately and visitors only ever
read the published snapshot.
"""
from django.core.exceptions import PermissionDenied, ValidationError
from django.utils import timezone

from apps.audit.context import audit_context, current_audit_context
from apps.audit.writer import record_event
from apps.authorization.access import effective_scope_for_site
from apps.authorization.services import permission_granted
from apps.cms.menu_models import CUSTOM_PATH, validate_external_url
from apps.organizations.hierarchy_lock import hierarchy_write

from .chrome_lint import enforce, lint_header
from .models import Site
from .models.header import HEADER_FIELDS, SiteHeader

MAX_URL = 2048


def defaults():
    return {
        "brand_href": "/",
        "variant": "standard",
        "search_enabled": True,
        "sticky": False,
        "cta_label": "",
        "cta_url": "",
        "language_switcher": False,
    }


def _safe_destination(value, *, allow_empty=True):
    """Accept a same-site path or an absolute http(s) URL, never raw markup."""
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ValidationError("Enter a safe destination.")
    if value == "":
        if allow_empty:
            return
        raise ValidationError("Enter a destination.")
    if len(value) > MAX_URL:
        raise ValidationError("Use at most 2048 characters.")
    if any(ord(char) < 32 or ord(char) == 127 or char == "\\" for char in value):
        raise ValidationError("Control characters and backslashes are not allowed.")
    if value.startswith("/"):
        if not CUSTOM_PATH.match(value):
            raise ValidationError("Use a same-site path such as / or /about.")
        return
    validate_external_url(value)


def validate_header(values):
    errors = {}
    for field in ("brand_href", "variant", "cta_label", "cta_url"):
        value = values.get(field)
        if not isinstance(value, str):
            errors[field] = "Enter plain text."
        elif any(ord(char) < 32 and char not in "\t" for char in value):
            errors[field] = "Enter plain text."
    for field in ("search_enabled", "sticky", "language_switcher"):
        if type(values.get(field)) is not bool:
            errors[field] = "Choose on or off."
    if "variant" not in errors and values.get("variant") not in {"standard", "centered", "compact"}:
        errors["variant"] = "Choose an approved header variant."
    if "brand_href" not in errors:
        try:
            _safe_destination(values.get("brand_href"), allow_empty=False)
        except ValidationError:
            errors["brand_href"] = "Use a same-site path such as / or an https URL."
    if len(values.get("cta_label", "") or "") > 120:
        errors["cta_label"] = "Use at most 120 characters."
    cta_url = values.get("cta_url", "") or ""
    cta_label = (values.get("cta_label", "") or "").strip()
    if cta_url:
        try:
            _safe_destination(cta_url, allow_empty=False)
        except ValidationError:
            errors["cta_url"] = "Use a same-site path or an https URL."
        if not cta_label:
            errors["cta_label"] = "Add a label for the call to action."
    elif cta_label:
        errors["cta_url"] = "Add a destination URL for the call to action."
    if errors:
        raise ValidationError(errors)


def header_values(row):
    return {field: getattr(row, field) for field in HEADER_FIELDS} if row else defaults()


def published_header_values(row):
    if row and isinstance(row.published_settings, dict):
        return {**defaults(), **{field: row.published_settings.get(field, defaults()[field]) for field in HEADER_FIELDS}}
    return defaults()


def header_has_unpublished_changes(row):
    return header_values(row) != (row.published_settings if row and isinstance(row.published_settings, dict) else defaults())


def header_etag(site_id, row):
    return f'"site-header-{site_id}-v{row.version if row else 0}"'


class HeaderPreconditionRequired(Exception):
    pass


class HeaderConflict(Exception):
    pass


def _require(actor, site):
    if (
        not actor or not actor.is_authenticated or not actor.is_active
        or not permission_granted(
            actor, "sites.update", site_id=site.pk,
            organization_id=effective_scope_for_site(site.pk), audit=False,
        )
    ):
        raise PermissionDenied("Site settings permission is required.")


def save_header(site_id, changes, *, actor, expected):
    if set(changes) - set(HEADER_FIELDS):
        raise ValidationError({"fields": "Unsupported header fields."})
    with hierarchy_write():
        site = Site.objects.select_for_update().get(pk=site_id)
        _require(actor, site)
        row = SiteHeader.objects.select_for_update().filter(site=site).first()
        if not expected:
            raise HeaderPreconditionRequired()
        if expected != header_etag(site.pk, row):
            raise HeaderConflict()
        values = {**header_values(row), **changes}
        validate_header(values)
        if row and values == header_values(row):
            return row
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id):
            if row is None:
                row = SiteHeader(site=site, created_by=actor)
            for field, value in values.items():
                setattr(row, field, value)
            row.updated_by = actor
            row.save()
        return row


def publish_header(site_id, *, actor, expected):
    with hierarchy_write():
        site = Site.objects.select_for_update().get(pk=site_id)
        _require(actor, site)
        row = SiteHeader.objects.select_for_update().filter(site=site).first()
        if not expected:
            raise HeaderPreconditionRequired()
        if expected != header_etag(site.pk, row):
            raise HeaderConflict()
        if row is None:
            raise ValidationError({"detail": "Save header settings before publishing."})
        values = header_values(row)
        validate_header(values)
        errors, warnings = lint_header(values)
        enforce(errors)
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id):
            previous = row.published_settings
            row.previous_published_settings = previous
            row.published_settings = values
            row.published_at = timezone.now()
            row.published_by = actor
            row.updated_by = actor
            row.save()
            record_event(
                action="SITE_HEADER_PUBLISHED", entity_type="sites.header", entity_id=row.pk,
                before=previous, after=values, changed_fields=sorted(values),
            )
        return row, warnings


def restore_previous_header(site_id, *, actor, expected):
    with hierarchy_write():
        site = Site.objects.select_for_update().get(pk=site_id)
        _require(actor, site)
        row = SiteHeader.objects.select_for_update().filter(site=site).first()
        if not expected:
            raise HeaderPreconditionRequired()
        if expected != header_etag(site.pk, row):
            raise HeaderConflict()
        previous = row.previous_published_settings if row else None
        if not row or not isinstance(previous, dict):
            raise ValidationError({"detail": "There is no previous published header to restore."})
        values = {**defaults(), **{field: previous.get(field, defaults()[field]) for field in HEADER_FIELDS}}
        validate_header(values)
        before = header_values(row)
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id):
            for field in HEADER_FIELDS:
                setattr(row, field, values[field])
            row.updated_by = actor
            row.save()
            record_event(
                action="SITE_HEADER_RESTORED", entity_type="sites.header", entity_id=row.pk,
                before=before, after=values, changed_fields=sorted(values),
            )
        return row
