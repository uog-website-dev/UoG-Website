"""Authorized menu operations; ownership is resolved from persisted records.

Direct model writes are reserved for trusted system jobs. User-facing callers
must use this contract, never accept Site ids or permission flags from a body.
"""
from contextlib import contextmanager
import hashlib
import json

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import connection
from django.db.models import Max
from django.utils import timezone

from apps.audit.context import audit_context, current_audit_context
from apps.audit.writer import record_event
from apps.authorization.access import effective_scope_for_site
from apps.authorization.services import permission_granted
from apps.organizations.hierarchy_lock import hierarchy_write

from ..menu_models import Menu, MenuItem, require_menus_module


MENU_FIELDS = frozenset({"location", "name", "is_active", "is_global"})
ITEM_FIELDS = frozenset({
    "label", "item_type", "page", "post", "target", "parent", "sort_order",
    "is_active", "allow_cross_site", "page_id", "post_id", "parent_id",
})


class MenuConflict(Exception):
    def __init__(self, reason):
        self.reason = reason
        super().__init__(reason)


class MenuPreconditionRequired(Exception):
    pass


def menu_etag(menu):
    return f'"menu-{menu.pk}-v{menu.version}"'


def _check_version(menu, expected):
    if not expected:
        raise MenuPreconditionRequired()
    if expected != menu_etag(menu):
        raise MenuConflict("version_conflict")


@contextmanager
def _operation(actor):
    if not actor or not actor.is_authenticated or not actor.is_active:
        raise PermissionDenied("An authenticated, active user is required.")
    previous = current_audit_context()
    with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=previous.request_id, ip=previous.ip):
        with hierarchy_write():
            yield


def authorize_menu(actor, site_id, *, edit=False, permission=None):
    permission = permission or ("menu.write" if edit else "menu.read")
    if not actor or not actor.is_authenticated or not actor.is_active:
        raise PermissionDenied("An authenticated, active user is required.")
    organization_id = effective_scope_for_site(site_id)
    if organization_id is None or not permission_granted(
        actor, permission, site_id=site_id, organization_id=organization_id, audit=False,
    ):
        raise PermissionDenied("Menu access to this Site is required.")
    if edit or permission == "menu.publish":
        require_menus_module(site_id)


def _write_menu(menu, actor):
    authorize_menu(actor, menu.site_id, edit=True)
    if menu.is_active:
        authorize_menu(actor, menu.site_id, permission="menu.publish")


def _unique_location(menu):
    if isinstance(menu.location, str):
        menu.location = menu.location.strip().lower()
    if menu.is_global:
        clash = Menu.objects.filter(is_global=True, location=menu.location)
    else:
        clash = Menu.objects.filter(site_id=menu.site_id, location=menu.location, is_global=False)
    if clash.exclude(pk=menu.pk).exists():
        raise MenuConflict("duplicate_location")


def _assign(instance, fields, allowed):
    if set(fields) - allowed:
        raise ValidationError({"fields": "Unsupported or server-managed menu fields."})
    for name, value in fields.items():
        setattr(instance, name, value)


def _target_permission(item, actor):
    # The model's explicit cross-site flag is a trusted domain opt-in, not
    # permission to read an arbitrary foreign draft in a user request.
    from apps.api.models import Post
    from ..models import Page
    model = Page if item.page_id else Post
    target_id = item.page_id if item.page_id else item.post_id
    if target_id is None:
        return
    target_site = model.objects.filter(pk=target_id).values_list("site_id", flat=True).first()
    if target_site is None or target_site == item.site_id:
        return  # Missing/unscoped targets are rejected by model validation.
    permission = "content.pages.view" if item.page_id else "content.posts.view"
    if not permission_granted(actor, permission, site_id=target_site,
        organization_id=effective_scope_for_site(target_site), audit=False):
        raise PermissionDenied("Access to the target's Site is required for cross-site links.")


def create_menu(*, actor, site_id, **fields):
    with _operation(actor):
        authorize_menu(actor, site_id, edit=True)
        menu = Menu(site_id=site_id)
        _assign(menu, fields, MENU_FIELDS)
        if menu.is_active:
            authorize_menu(actor, menu.site_id, permission="menu.publish")
        _unique_location(menu)
        menu.save()
        return menu


def update_menu(menu_id, *, actor, expected=None, **fields):
    with _operation(actor):
        menu = Menu.objects.get(pk=menu_id)
        _write_menu(menu, actor)
        _assign(menu, fields, MENU_FIELDS)
        _check_version(menu, expected)
        if "is_active" in fields:
            authorize_menu(actor, menu.site_id, permission="menu.publish")
        _unique_location(menu)
        menu.save()
        return menu


def create_menu_item(menu_id, *, actor, expected=None, **fields):
    with _operation(actor):
        menu = Menu.objects.get(pk=menu_id)
        _write_menu(menu, actor)
        item = MenuItem(menu=menu, site_id=menu.site_id)
        _assign(item, fields, ITEM_FIELDS)
        _target_permission(item, actor)
        _check_version(menu, expected)
        if "sort_order" not in fields:
            maximum = menu.items.filter(parent_id=item.parent_id).aggregate(value=Max("sort_order"))["value"]
            item.sort_order = 0 if maximum is None else maximum + 1
        elif menu.items.filter(parent_id=item.parent_id, sort_order=item.sort_order).exists():
            raise MenuConflict("duplicate_order")
        if menu.items.count() >= 1000:
            raise ValidationError({"tree": "A menu supports at most 1000 items through this API."})
        item.save()
        return item


def update_menu_item(item_id, *, actor, expected=None, **fields):
    with _operation(actor):
        item = MenuItem.objects.get(pk=item_id)
        menu = Menu.objects.get(pk=item.menu_id)
        _write_menu(menu, actor)
        _assign(item, fields, ITEM_FIELDS)
        _target_permission(item, actor)
        _check_version(menu, expected)
        item.save()
        return item


def delete_menu_record(record_id, *, actor, expected=None, item=False):
    with _operation(actor):
        record = (MenuItem if item else Menu).objects.get(pk=record_id)
        menu = Menu.objects.get(pk=record.menu_id) if item else record
        _write_menu(menu, actor)
        _check_version(menu, expected)
        if (record.children if item else record.items).exists():
            raise MenuConflict("children_present")
        record.delete()


def set_menu_active(menu_id, *, actor, expected, active):
    with _operation(actor):
        menu = Menu.objects.get(pk=menu_id)
        authorize_menu(actor, menu.site_id, permission="menu.publish")
        _check_version(menu, expected)
        menu.is_active = active
        menu.save(update_fields=["is_active"])
        return menu


def _apply_order(rows):
    if not rows:
        return
    with connection.cursor() as cursor:
        cursor.execute("SET CONSTRAINTS menu_item_sibling_order DEFERRED")
    for row in rows:
        row.updated_at = timezone.now()
    # One final-state UPDATE, with the unique check deferred until all rows
    # have moved. Tree triggers still validate the complete final graph.
    MenuItem.objects.bulk_update(rows, ["parent", "sort_order", "updated_at"], batch_size=1000)
    with connection.cursor() as cursor:
        cursor.execute("SET CONSTRAINTS menu_item_sibling_order IMMEDIATE")


def _order_snapshot(menu, parent, ids):
    return {"site_id": menu.site_id, "menu_id": str(menu.pk), "parent_id": str(parent) if parent else None,
            "count": len(ids), "order_sha256": hashlib.sha256(json.dumps([str(pk) for pk in ids]).encode()).hexdigest()}


def reorder_menu(menu_id, *, actor, expected, parent_id, item_ids):
    with _operation(actor):
        menu = Menu.objects.get(pk=menu_id)
        _write_menu(menu, actor)
        _check_version(menu, expected)
        if parent_id is not None and not menu.items.filter(pk=parent_id).exists():
            raise ValidationError({"parent": "The parent must belong to this menu."})
        rows = list(menu.items.filter(parent_id=parent_id).order_by("sort_order", "id"))
        if len(rows)>1000 or len(item_ids)!=len(set(item_ids)) or set(item_ids)!={row.pk for row in rows}:
            raise ValidationError({"order": "Supply every sibling exactly once, with at most 1000 items."})
        before = _order_snapshot(menu, parent_id, [row.pk for row in rows])
        by_id = {row.pk: row for row in rows}
        for position, pk in enumerate(item_ids):
            by_id[pk].sort_order = position
        _apply_order(list(by_id.values()))
        after = _order_snapshot(menu, parent_id, item_ids)
        if before != after:
            record_event(action="MENU_ITEMS_REORDERED", entity_type="cms.menu", entity_id=menu.pk,
                         before=before, after=after, changed_fields=["order"])
        from ..menu_cache import invalidate_menu_state
        invalidate_menu_state(menu.site_id, menu.location, menu.is_global)
        menu.refresh_from_db()
        return menu


def move_menu_item(item_id, *, actor, expected, parent_id, position):
    with _operation(actor):
        item = MenuItem.objects.get(pk=item_id)
        menu = Menu.objects.get(pk=item.menu_id)
        _write_menu(menu, actor)
        _check_version(menu, expected)
        if parent_id is not None and not menu.items.filter(pk=parent_id).exists():
            raise ValidationError({"parent": "The parent must belong to this menu."})
        groups = [item.parent_id] if item.parent_id == parent_id else [item.parent_id, parent_id]
        affected = []
        for group in groups:
            rows = list(menu.items.filter(parent_id=group).exclude(pk=item.pk).order_by("sort_order", "id"))
            if group == parent_id:
                if not isinstance(position, int) or isinstance(position, bool) or not 0 <= position <= len(rows):
                    raise ValidationError({"order": "Position must be a valid index in the destination siblings."})
                item.parent_id = parent_id
                rows.insert(position, item)
            for index, row in enumerate(rows):
                row.sort_order = index
            affected.extend(rows)
        if len(affected)>1000:
            raise ValidationError({"tree": "A move supports at most 1000 affected items."})
        _apply_order(affected)
        from ..menu_cache import invalidate_menu_state
        invalidate_menu_state(menu.site_id, menu.location, menu.is_global)
        item.refresh_from_db()
        return item
