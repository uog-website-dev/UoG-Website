"""Typed footer settings, draft/publication split and Site-scoped maintenance.

Draft values live in the model columns as before. Publishing copies them into
`published_settings`, keeps the outgoing publication in
`previous_published_settings`, and never exposes draft copy to visitors. The
footer and header share the same ETag/version and audit conventions.
"""
import re
from urllib.parse import urlsplit

from django.core.exceptions import PermissionDenied, ValidationError
from django.utils import timezone

from apps.audit.context import audit_context, current_audit_context
from apps.audit.writer import record_event
from apps.authorization.access import effective_scope_for_site
from apps.authorization.services import permission_granted
from apps.organizations.hierarchy_lock import hierarchy_write

from .chrome_lint import enforce, lint_footer
from .models import Site
from .models.footer import COPYRIGHT_DEFAULT, FOOTER_FIELDS, SiteFooter

SOCIAL_PLATFORMS = ("x", "youtube", "facebook", "linkedin", "telegram", "tiktok", "instagram")
MAX_COLUMNS = 4
COLUMN_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def defaults():
    return {
        "newsletter_label": "", "newsletter_url": "", "support_label": "", "support_url": "",
        "description": "", "address": "", "email": "", "phone": "",
        "links_heading": "Explore", "highlight_label": "", "highlight_url": "",
        "copyright_text": COPYRIGHT_DEFAULT, "social_links": [], "legal_links": [], "columns": [],
    }


def validate_link(value, *, https_only=False):
    from apps.cms.menu_models import validate_external_url
    validate_external_url(value)
    if https_only and urlsplit(value).scheme.lower() != "https":
        raise ValidationError("Use an HTTPS social profile URL.")


def validate_columns(columns):
    errors = {}
    if not isinstance(columns, list) or len(columns) > MAX_COLUMNS:
        return {"columns": f"Use at most {MAX_COLUMNS} footer columns."}
    for index, column in enumerate(columns):
        path = f"columns.{index}"
        if not isinstance(column, dict) or set(column) - {"menu", "heading", "description"}:
            errors[path] = "Choose a heading and an optional description."
            continue
        menu = column.get("menu")
        if menu is not None and (not isinstance(menu, str) or COLUMN_ID.match(menu) is None):
            errors[f"{path}.menu"] = "Choose a Site menu for this column."
        heading = column.get("heading")
        if not isinstance(heading, str) or not 1 <= len(heading.strip()) <= 80:
            errors[f"{path}.heading"] = "Use a public heading of at most 80 characters."
        description = column.get("description", "")
        if not isinstance(description, str) or len(description) > 300:
            errors[f"{path}.description"] = "Use at most 300 characters."
    return errors


def validate_column_menus(site_id, columns):
    """A column may only reference this Site's own (non-global) menus."""
    identifiers = [column["menu"] for column in columns if isinstance(column, dict) and column.get("menu")]
    if not identifiers:
        return
    from apps.cms.menu_models import Menu
    known = {str(pk) for pk in Menu.objects.filter(
        site_id=site_id, pk__in=identifiers, is_global=False,
    ).values_list("pk", flat=True)}
    errors = {
        f"columns.{index}.menu": "Choose a menu owned by this Site."
        for index, column in enumerate(columns)
        if isinstance(column, dict) and column.get("menu") and column["menu"] not in known
    }
    if errors:
        raise ValidationError(errors)


def validate_footer(values):
    errors = {}
    for field in FOOTER_FIELDS:
        if field in ("social_links", "legal_links", "columns"):
            continue
        value = values.get(field)
        if not isinstance(value, str) or any(ord(c) < 32 and c not in "\n\r\t" for c in value):
            errors[field] = "Enter plain text."
    if values.get("highlight_url"):
        try:
            validate_link(values["highlight_url"])
        except ValidationError:
            errors["highlight_url"] = "Use a safe HTTP or HTTPS URL."
        if not values.get("highlight_label", "").strip():
            errors["highlight_label"] = "Add a label for the featured link."
    for prefix in ("newsletter", "support"):
        if values.get(prefix + "_url"):
            try:
                validate_link(values[prefix + "_url"], https_only=True)
            except ValidationError:
                errors[prefix + "_url"] = "Use an approved HTTPS destination."
            if not values.get(prefix + "_label", "").strip():
                errors[prefix + "_label"] = "Add an accessible link label."
    text = values.get("copyright_text", "")
    if isinstance(text, str) and any(token not in ("{year}", "{site}") for token in re.findall(r"\{[^}]*\}", text)):
        errors["copyright_text"] = "Only {year} and {site} placeholders are supported."
    social = values.get("social_links")
    if not isinstance(social, list) or len(social) > len(SOCIAL_PLATFORMS):
        errors["social_links"] = "Choose at most seven social profiles."
    else:
        seen = set()
        for index, item in enumerate(social):
            key = f"social_links.{index}"
            if not isinstance(item, dict) or set(item) != {"platform", "url"} or item.get("platform") not in SOCIAL_PLATFORMS:
                errors[key] = "Choose a supported social platform and URL."
                continue
            if item["platform"] in seen:
                errors[key + ".platform"] = "This platform is already configured."
            seen.add(item["platform"])
            try:
                if not isinstance(item["url"], str) or len(item["url"]) > 2048:
                    raise ValidationError("URL length")
                validate_link(item["url"], https_only=True)
            except ValidationError:
                errors[key + ".url"] = "Use a safe HTTPS social profile URL."
    legal_links = values.get("legal_links")
    if not isinstance(legal_links, list) or len(legal_links) > 10:
        errors["legal_links"] = "Use at most ten legal or accessibility links."
    else:
        seen = set()
        for index, item in enumerate(legal_links):
            key = f"legal_links.{index}"
            if not isinstance(item, dict) or set(item) - {"label", "url"} or not item.get("label") or not item.get("url"):
                errors[key] = "Add a label and URL."
                continue
            label = item["label"]
            if not isinstance(label, str) or not label.strip() or len(label) > 80:
                errors[f"{key}.label"] = "Use a public label of at most 80 characters."
            url = item["url"]
            if not isinstance(url, str) or len(url) > 2048:
                errors[f"{key}.url"] = "Use a safe URL."
            else:
                try:
                    validate_link(url)
                except ValidationError:
                    errors[f"{key}.url"] = "Use a safe HTTP or HTTPS URL."
                if label in seen:
                    errors[f"{key}.label"] = "Use a unique link label."
                seen.add(label)
    errors.update(validate_columns(values.get("columns")))
    if errors:
        raise ValidationError(errors)


def footer_values(row):
    return {field: getattr(row, field) for field in FOOTER_FIELDS} if row else defaults()


def published_footer_values(row):
    """The document visitors see. Draft values are never read publicly."""
    if row and isinstance(row.published_settings, dict):
        return {**defaults(), **{field: row.published_settings.get(field, defaults()[field]) for field in FOOTER_FIELDS}}
    return defaults()


def footer_has_unpublished_changes(row):
    return footer_values(row) != (row.published_settings if row and isinstance(row.published_settings, dict) else defaults())


def footer_etag(site_id, row):
    return f'"site-footer-{site_id}-v{row.version if row else 0}"'


def apply_footer_column_copy(nodes, columns):
    """Override public menu column labels with the Site's own published copy."""
    copy = {column["menu"]: column for column in columns if isinstance(column, dict) and column.get("menu")}
    order = {column["menu"]: index for index, column in enumerate(columns) if isinstance(column, dict) and column.get("menu")}
    result = []
    for node in nodes:
        column = copy.get(node.get("menu"))
        if column:
            node = {
                **node,
                "label": (column.get("heading") or "").strip() or node.get("label", ""),
                "description": column.get("description", ""),
            }
        else:
            node = {**node, "description": node.get("description", "")}
        result.append(node)
    result.sort(key=lambda item: order.get(item.get("menu"), len(order)))
    return result


def editor_footer_columns(row, nodes):
    """Merge draft column copy with the currently published footer menus."""
    columns = footer_values(row)["columns"]
    by_menu = {column["menu"]: column for column in columns if isinstance(column, dict) and column.get("menu")}
    order = {column["menu"]: index for index, column in enumerate(columns) if isinstance(column, dict) and column.get("menu")}
    result = []
    for node in nodes:
        menu = node.get("menu")
        current = by_menu.get(menu, {})
        result.append({
            "menu": menu,
            "menu_name": node.get("label"),
            "heading": current.get("heading") or node.get("label") or "",
            "description": current.get("description", ""),
        })
    missing = [column["menu"] for column in columns if isinstance(column, dict) and column.get("menu") and all(item["menu"] != column["menu"] for item in result)]
    if missing and row is not None:
        from apps.cms.menu_models import Menu
        names = {str(pk): name for pk, name in Menu.objects.filter(site_id=row.site_id, pk__in=missing).values_list("pk", "name")}
        for column in columns:
            if isinstance(column, dict) and column.get("menu") in missing:
                result.append({"menu": column["menu"], "menu_name": names.get(column["menu"]), "heading": column.get("heading", ""), "description": column.get("description", "")})
    result.sort(key=lambda item: order.get(item.get("menu"), len(order)))
    return result


class FooterPreconditionRequired(Exception):
    pass


class FooterConflict(Exception):
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


def save_footer(site_id, changes, *, actor, expected):
    if set(changes) - set(FOOTER_FIELDS):
        raise ValidationError({"fields": "Unsupported footer fields."})
    with hierarchy_write():
        site = Site.objects.select_for_update().get(pk=site_id)
        _require(actor, site)
        row = SiteFooter.objects.select_for_update().filter(site=site).first()
        if not expected:
            raise FooterPreconditionRequired()
        if expected != footer_etag(site.pk, row):
            raise FooterConflict()
        values = {**footer_values(row), **changes}
        validate_footer(values)
        validate_column_menus(site.pk, values["columns"])
        if row and values == footer_values(row):
            return row
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id):
            if row is None:
                row = SiteFooter(site=site, created_by=actor)
            for field, value in values.items():
                setattr(row, field, value)
            row.updated_by = actor
            row.save()
        return row


def publish_footer(site_id, *, actor, expected):
    """Publish the saved draft after validation and the copy lint."""
    with hierarchy_write():
        site = Site.objects.select_for_update().get(pk=site_id)
        _require(actor, site)
        row = SiteFooter.objects.select_for_update().filter(site=site).first()
        if not expected:
            raise FooterPreconditionRequired()
        if expected != footer_etag(site.pk, row):
            raise FooterConflict()
        if row is None:
            raise ValidationError({"detail": "Save footer settings before publishing."})
        values = footer_values(row)
        validate_footer(values)
        validate_column_menus(site.pk, values["columns"])
        errors, warnings = lint_footer(values)
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
                action="SITE_FOOTER_PUBLISHED", entity_type="sites.footer", entity_id=row.pk,
                before=previous, after=values, changed_fields=sorted(values),
            )
        return row, warnings


def restore_previous_footer(site_id, *, actor, expected):
    """Bring the previous published document back into the draft for review."""
    with hierarchy_write():
        site = Site.objects.select_for_update().get(pk=site_id)
        _require(actor, site)
        row = SiteFooter.objects.select_for_update().filter(site=site).first()
        if not expected:
            raise FooterPreconditionRequired()
        if expected != footer_etag(site.pk, row):
            raise FooterConflict()
        previous = row.previous_published_settings if row else None
        if not row or not isinstance(previous, dict):
            raise ValidationError({"detail": "There is no previous published footer to restore."})
        values = {**defaults(), **{field: previous.get(field, defaults()[field]) for field in FOOTER_FIELDS}}
        validate_footer(values)
        before = footer_values(row)
        context = current_audit_context()
        with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id):
            for field in FOOTER_FIELDS:
                setattr(row, field, values[field])
            row.updated_by = actor
            row.save()
            record_event(
                action="SITE_FOOTER_RESTORED", entity_type="sites.footer", entity_id=row.pk,
                before=before, after=values, changed_fields=sorted(values),
            )
        return row
