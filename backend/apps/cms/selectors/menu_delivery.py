"""Effective public menu for one resolved Site and location.

Precedence, from the start of the list:
1. The active global fragment for the location, when this Site opts in.
2. The parent Site's own active local menu, when inheritance is set and this
   Site is not overriding it.
3. This Site's active local menu. ``override`` replaces segment 2 whenever a
   local menu is active. ``append`` places local items after segment 2.
   A missing policy is local-only: no global fragment and no parent.

A published location assignment supplies the local segment but does not drop
global or inherited segments. An inactive menu is absent. An inactive item
hides its descendants. A page is shown only when it is published and PUBLIC
or UNLISTED. A post is shown only when it is published. Hidden, draft,
unpublished and missing targets drop the item and its descendants. External
and custom items stay. Inheritance copies the parent's local menu only, so a
parent's own parent is not pulled in.
"""
from apps.sites.models import Site
from apps.sites.selectors.modules import module_is_available

from ..menu_models import Menu, MenuInheritance


def compose_location(site_id, location):
    from apps.sites.menu_locations import locations_for_site, MENU_SLOTS

    site = Site.objects.select_related("template").get(pk=site_id)
    if location in MENU_SLOTS and location not in locations_for_site(site):
        return []
    if not _site_serves(site_id):
        return []
    local_menu, local_menu_ids = resolve_local_menu(site_id, location, draft=False)
    return compose_with_local(
        site_id, location, local_menu=local_menu, local_menu_ids=local_menu_ids, draft=False,
    )


def compose_with_local(
    site_id, location, *, local_menu=None, local_menu_ids=None, draft=False,
):
    """Compose global + inherited + the supplied local segment.

    ``local_menu`` / ``local_menu_ids`` are the caller's resolved local segment
    (published assignment, draft assignment, or legacy active menu). Preview
    passes draft trees; public delivery passes published/active ones.
    """
    policy = MenuInheritance.objects.filter(site_id=site_id, location=location).first()
    include_global = bool(policy and policy.include_global)
    inherit_from_id = policy.inherit_from_id if policy else None
    precedence = policy.local_precedence if policy else "override"

    # Only an active local menu may override inheritance. Draft preview may
    # still project an inactive working menu as the local segment.
    active_local = bool(local_menu_ids) or (
        local_menu is not None
        and not local_menu.is_global
        and local_menu.is_active
    )

    items = []
    global_menu = (
        Menu.objects.filter(is_global=True, location=location, is_active=True).first()
        if include_global else None
    )
    if global_menu is not None and _site_serves(global_menu.site_id):
        items.extend(_project(global_menu, "global", draft=False))

    use_parent = (
        inherit_from_id
        and inherit_from_id != site_id
        and _is_inheritance_parent(site_id, inherit_from_id)
        and _site_serves(inherit_from_id)
        and not (active_local and precedence == "override")
    )
    if use_parent:
        parent_menu, parent_ids = resolve_local_menu(
            inherit_from_id, location, draft=False,
        )
        if parent_ids:
            items.extend(
                _retag_source(
                    footer_columns(inherit_from_id, parent_ids, draft=False),
                    "inherited",
                )
            )
        elif parent_menu is not None:
            items.extend(_project(parent_menu, "inherited", draft=False))

    if local_menu_ids:
        items.extend(footer_columns(site_id, local_menu_ids, draft=draft))
    elif local_menu is not None and (draft or local_menu.is_active):
        items.extend(_project(local_menu, "local", draft=draft))
    return items


def resolve_local_menu(site_id, location, *, draft=False):
    """Return ``(menu, menu_ids)`` for this Site's local segment.

    Published/draft assignments win over legacy location-matched menus.
    An explicit published or draft unassignment yields ``(None, None)`` and
    does not fall back to a legacy menu. Footer multi-menu assignments return
    ``(None, ids)``.
    """
    from ..menu_assignment_models import MenuLocationAssignment

    assigned = (
        MenuLocationAssignment.objects
        .filter(site_id=site_id, location=location)
        .select_related("published_menu", "draft_menu")
        .first()
    )
    if draft:
        if assigned is not None:
            if location == "footer" and assigned.draft_menus:
                return None, list(assigned.draft_menus)
            menu = assigned.draft_menu
            if (
                menu is not None
                and menu.site_id == site_id
                and not menu.is_global
            ):
                return menu, None
            return None, None
    elif assigned is not None and assigned.is_published:
        if location == "footer" and assigned.published_menus:
            return None, list(assigned.published_menus)
        menu = assigned.published_menu
        if (
            menu is not None
            and menu.site_id == site_id
            and not menu.is_global
            and menu.is_active
        ):
            return menu, None
        return None, None

    legacy_qs = Menu.objects.filter(
        site_id=site_id, location=location, is_global=False,
    )
    if not draft:
        legacy_qs = legacy_qs.filter(is_active=True)
    return legacy_qs.first(), None


def _retag_source(nodes, source):
    return [
        {**node, "source": source, "children": _retag_source(node.get("children") or [], source)}
        for node in nodes
    ]


def _site_serves(site_id):
    if not site_id:
        return False
    return (
        Site.objects.filter(pk=site_id, status=Site.Status.ACTIVE).exists()
        and module_is_available(site_id, "MENUS")
    )


def _is_inheritance_parent(site_id, inherit_from_id):
    """Allow inherit_from only when its organization unit is this Site's unit or an ancestor."""
    rows = dict(
        Site.objects.filter(pk__in=(site_id, inherit_from_id)).values_list("pk", "organization_unit_id")
    )
    child_unit = rows.get(site_id)
    parent_unit = rows.get(inherit_from_id)
    if child_unit is None or parent_unit is None or inherit_from_id == site_id:
        return False
    if child_unit == parent_unit:
        return True
    from apps.organizations.models import OrganizationUnit
    from apps.organizations.selectors.hierarchy import get_ancestors
    try:
        return any(unit.pk == parent_unit for unit in get_ancestors(child_unit))
    except OrganizationUnit.DoesNotExist:
        return False


def _project(menu, source, *, draft=False):
    if menu is None:
        return []
    from django.core.exceptions import ValidationError
    from ..menu_destinations import published_rows, resolve_destinations, menu_origin
    rows = list(menu.items.order_by("sort_order", "id")[:1001]) if draft else published_rows(menu)
    if len(rows) > 1000:
        raise ValidationError({
            "tree": "A menu preview supports at most 1000 items." if draft else "A published menu supports at most 1000 items.",
        })
    origin = menu_origin(menu.site_id) if source != "local" else None
    destinations = resolve_destinations(rows)
    children = {}
    for row in rows:
        children.setdefault(row.parent_id, []).append(row)

    def branch(parent_id):
        rendered = []
        for row in children.get(parent_id, ()):
            destination = destinations.get(getattr(row, "pk", None) or id(row))
            if destination and destination.startswith("/") and source != "local":
                destination = origin + destination if origin else None
            if not row.is_active or (destination is None and not draft):
                continue
            rendered.append({
                "label": row.label,
                "href": destination or "",
                **({"destination_status": "ready" if destination else "unavailable"} if draft else {}),
                "source": source,
                "children": branch(row.pk),
            })
        return rendered

    return branch(None)


def footer_columns(site_id, ids, *, draft=False):
    """Keep each configured menu as one ordered footer column.

    Public output uses the footer settings' published headings, descriptions
    and order, so renaming the internal menu never changes visitor-facing copy.
    """
    menus = {str(m.pk): m for m in Menu.objects.filter(site_id=site_id, pk__in=ids, is_global=False)}
    result = []
    for identifier in ids:
        menu = menus.get(identifier)
        if menu is None or (not draft and not menu.is_active):
            continue
        result.append({
            "menu": str(menu.pk), "label": menu.name, "href": "", "source": "local",
            "column": True, "description": "", "children": _project(menu, "local", draft=draft),
        })
    if not draft:
        from apps.sites.footer import apply_footer_column_copy, published_footer_values
        from apps.sites.models import SiteFooter
        row = SiteFooter.objects.filter(site_id=site_id).first()
        result = apply_footer_column_copy(result, published_footer_values(row)["columns"])
    return result
