"""Bump public menu cache generations for the Sites a change can affect.

A local menu change reaches its owner and Sites that explicitly inherit from
that owner. A global fragment reaches every Site that opted into it. A
delivery-policy change reaches only the Site that owns the policy, because
heirs copy the parent Site's local menu and not its composed tree.
"""
from django.db.models import F


def invalidate_menu_state(site_id, location, is_global):
    from .menu_models import MenuInheritance

    affected = {site_id}
    if is_global:
        affected.update(
            MenuInheritance.objects.filter(location=location, include_global=True)
            .values_list("site_id", flat=True)
        )
    else:
        affected.update(
            MenuInheritance.objects.filter(location=location, inherit_from_id=site_id)
            .values_list("site_id", flat=True)
        )
    _bump(affected, location)


def invalidate_delivery(site_id, location):
    _bump({site_id}, location)


def delivery_version(site_id, location):
    from .menu_models import MenuDeliveryVersion

    return (
        MenuDeliveryVersion.objects.filter(site_id=site_id, location=location)
        .values_list("version", flat=True)
        .first()
        or 0
    )


def _bump(site_ids, location):
    from .menu_models import MenuDeliveryVersion

    for site_id in site_ids:
        row, created = MenuDeliveryVersion.objects.get_or_create(
            site_id=site_id, location=location, defaults={"version": 1},
        )
        if not created:
            MenuDeliveryVersion.objects.filter(pk=row.pk).update(version=F("version") + 1)
