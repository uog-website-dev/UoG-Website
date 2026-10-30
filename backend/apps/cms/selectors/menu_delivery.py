"""Effective public menu for one resolved Site and location.

Precedence, from the start of the list:
1. The active global fragment for the location, when this Site opts in.
2. The parent Site's own active local menu, when inheritance is set and this
   Site is not overriding it.
3. This Site's active local menu. ``override`` replaces segment 2 whenever a
   local menu is active. ``append`` places local items after segment 2.
   A missing policy is local-only: no global fragment and no parent.

An inactive menu is absent. An inactive item hides its descendants. A page is
shown only when it is published and PUBLIC or UNLISTED. A post is shown only
when it is published. Hidden, draft, unpublished and missing targets drop the
item and its descendants. External and custom items stay. Inheritance copies
the parent's local menu only, so a parent's own parent is not pulled in.
"""
from apps.api.models import Post
from apps.sites.models import Site
from apps.sites.selectors.modules import module_is_available

from ..menu_models import Menu, MenuInheritance, MenuItem
from ..models import ContentStatus, Page, Visibility


_SHOWN_VISIBILITY = frozenset({Visibility.PUBLIC, Visibility.UNLISTED})


def compose_location(site_id, location):
    policy = MenuInheritance.objects.filter(site_id=site_id, location=location).first()
    include_global = bool(policy and policy.include_global)
    inherit_from_id = policy.inherit_from_id if policy else None
    precedence = policy.local_precedence if policy else "override"
    items = []
    if include_global and _site_serves(Menu.objects.filter(is_global=True, location=location, is_active=True).values_list("site_id", flat=True).first()):
        global_menu = Menu.objects.filter(is_global=True, location=location, is_active=True).first()
        items.extend(_project(global_menu, "global"))
    local_menu = Menu.objects.filter(site_id=site_id, location=location, is_global=False, is_active=True).first()
    use_parent = inherit_from_id and _site_serves(inherit_from_id) and not (local_menu and precedence == "override")
    if use_parent:
        parent_menu = Menu.objects.filter(
            site_id=inherit_from_id, location=location, is_global=False, is_active=True,
        ).first()
        items.extend(_project(parent_menu, "inherited"))
    if local_menu is not None:
        items.extend(_project(local_menu, "local"))
    return items


def _site_serves(site_id):
    if not site_id:
        return False
    return (
        Site.objects.filter(pk=site_id, status=Site.Status.ACTIVE).exists()
        and module_is_available(site_id, "MENUS")
    )


def _project(menu, source):
    if menu is None:
        return []
    rows = list(menu.items.order_by("sort_order", "id"))
    pages = {
        page.pk: page
        for page in Page.objects.filter(pk__in=[row.page_id for row in rows if row.page_id])
    }
    posts = {
        post.pk: post
        for post in Post.objects.filter(pk__in=[row.post_id for row in rows if row.post_id])
    }
    children = {}
    for row in rows:
        children.setdefault(row.parent_id, []).append(row)

    def href(row):
        if row.item_type == MenuItem.ItemType.PAGE:
            return pages[row.page_id].path
        if row.item_type == MenuItem.ItemType.POST:
            return f"/posts/{posts[row.post_id].slug}"
        return row.target

    def available(row):
        if row.item_type == MenuItem.ItemType.PAGE:
            page = pages.get(row.page_id)
            return bool(
                page and page.status == ContentStatus.PUBLISHED and page.visibility in _SHOWN_VISIBILITY
                and (page.site_id == row.site_id or row.allow_cross_site)
            )
        if row.item_type == MenuItem.ItemType.POST:
            post = posts.get(row.post_id)
            return bool(post and post.is_published and post.site_id and (post.site_id == row.site_id or row.allow_cross_site))
        return row.item_type in {MenuItem.ItemType.EXTERNAL, MenuItem.ItemType.CUSTOM}

    def branch(parent_id):
        rendered = []
        for row in children.get(parent_id, ()):
            if not row.is_active or not available(row):
                continue
            rendered.append({
                "label": row.label,
                "href": href(row),
                "source": source,
                "children": branch(row.pk),
            })
        return rendered

    return branch(None)
