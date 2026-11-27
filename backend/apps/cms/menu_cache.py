"""Bump public menu cache generations for the Sites a change can affect.

A local menu change reaches its owner and Sites that explicitly inherit from
that owner. A global fragment reaches every Site that opted into it. A
delivery-policy change reaches only the Site that owns the policy, because
heirs copy the parent Site's local menu and not its composed tree.
"""
from django.db.models import F
from django.db import DEFAULT_DB_ALIAS


def invalidate_menu_state(
    site_id, location, is_global, *, using=DEFAULT_DB_ALIAS,
):
    from .menu_models import MenuInheritance
    # Named menus may be assigned to slots unrelated to their legacy location,
    # including additional footer columns. Refresh the owner's explicit slots.
    from .menu_assignment_models import MenuLocationAssignment
    slots=MenuLocationAssignment.objects.using(using).filter(site_id=site_id,is_published=True).values_list('location',flat=True)
    for slot in slots:
        if slot!=location:
            _bump({site_id},slot,using=using)
    if not location: return

    affected = {site_id}
    if is_global:
        affected.update(
            MenuInheritance.objects.using(using).filter(
                location=location, include_global=True,
            )
            .values_list("site_id", flat=True)
        )
    else:
        affected.update(
            MenuInheritance.objects.using(using).filter(
                location=location, inherit_from_id=site_id,
            )
            .values_list("site_id", flat=True)
        )
    _bump(affected, location, using=using)


def invalidate_delivery(site_id, location):
    _bump({site_id}, location)


def invalidate_site_menus(site_id, *, using=DEFAULT_DB_ALIAS):
    """Bump every location for a Site after destination modules change."""
    from .menu_models import MENU_LOCATIONS

    for location in MENU_LOCATIONS:
        _bump({site_id}, location, using=using)


def invalidate_post_delivery(post_id, *, using=DEFAULT_DB_ALIAS):
    """Invalidate menus that link to a Post (local, inherited, or global)."""
    invalidate_linked_menus(post_id=post_id, using=using)


def invalidate_linked_menus(
    *, page_id=None, post_id=None, category_id=None, using=DEFAULT_DB_ALIAS,
):
    """Bump every menu that points at the given Page, Post, or Category."""
    from django.db.models import Q

    from .menu_models import MenuItem

    query = Q()
    if page_id is not None:
        query |= Q(page_id=page_id)
    if post_id is not None:
        query |= Q(post_id=post_id)
    if category_id is not None:
        query |= Q(category_id=category_id)
    if not query:
        return
    links = (
        MenuItem.objects.using(using)
        .filter(query)
        .values_list("site_id", "menu__location", "menu__is_global")
        .distinct()
    )
    for site_id, location, is_global in links:
        invalidate_menu_state(site_id, location, is_global, using=using)


def delivery_version(site_id, location):
    from .menu_models import MenuDeliveryVersion

    return (
        MenuDeliveryVersion.objects.filter(site_id=site_id, location=location)
        .values_list("version", flat=True)
        .first()
        or 0
    )


def _bump(site_ids, location, *, using=DEFAULT_DB_ALIAS):
    from .menu_models import MenuDeliveryVersion

    for site_id in site_ids:
        row, created = MenuDeliveryVersion.objects.using(using).get_or_create(
            site_id=site_id, location=location, defaults={"version": 1},
        )
        if not created:
            MenuDeliveryVersion.objects.using(using).filter(pk=row.pk).update(
                version=F("version") + 1,
            )
