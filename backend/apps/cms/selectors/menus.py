"""Bounded, deterministic trees loaded in one item query; no public serving."""
from django.core.exceptions import ValidationError

from ..menu_models import Menu
from ..services.menus import authorize_menu


def menu_tree(menu_id, *, actor, include_inactive=False, limit=1000):
    menu = Menu.objects.get(pk=menu_id)
    authorize_menu(actor, menu.site_id)
    if not include_inactive and not menu.is_active:
        return []
    rows = list(menu.items.order_by("sort_order", "id")[:limit + 1])
    if len(rows) > limit:
        raise ValidationError({"tree": "The menu exceeds the tree response limit."})
    children = {}
    for row in rows:
        children.setdefault(row.parent_id, []).append(row)

    def branch(parent_id):
        return [
            {"item": row, "children": branch(row.pk)}
            for row in children.get(parent_id, ())
            if include_inactive or row.is_active
        ]

    # An inactive branch hides all descendants, even if a child is active.
    return branch(None)
