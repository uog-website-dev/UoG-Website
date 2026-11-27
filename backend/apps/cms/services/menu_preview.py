"""Private previews use authenticated Site context, never public cache entries."""
from django.core.exceptions import ValidationError

from apps.sites.menu_locations import locations_for_site

from apps.cms.menu_assignment_models import MenuLocationAssignment
from apps.cms.selectors.menu_delivery import (
    compose_with_local,
    resolve_local_menu,
    _project,
)
from .menus import authorize_menu, authorize_central_menu


def preview_navigation(site, *, actor, menu=None):
    authorize_menu(actor, site.pk, edit=True)
    if menu and menu.site_id != site.pk:
        raise ValidationError({"menu": "Choose a menu owned by this Site."})
    if menu and menu.is_global:
        authorize_central_menu(actor)
    from ..menu_destinations import menu_origin
    origin = menu_origin(site.pk)
    if menu:
        locations = {
            menu.location if menu.location in locations_for_site(site) else "header":
            _project(menu, "local", draft=True),
        }
    else:
        locations = {}
        for location in locations_for_site(site):
            assigned = MenuLocationAssignment.objects.filter(
                site=site, location=location,
            ).select_related("draft_menu").first()
            if assigned and assigned.draft_menu_id:
                chosen = assigned.draft_menu
                if chosen.site_id != site.pk or chosen.is_global:
                    raise ValidationError({
                        "menu": "Choose a local menu owned by this Site.",
                    })
            local_menu, local_menu_ids = resolve_local_menu(
                site.pk, location, draft=True,
            )
            locations[location] = compose_with_local(
                site.pk,
                location,
                local_menu=local_menu,
                local_menu_ids=local_menu_ids,
                draft=True,
            )
    return {
        "site": site.pk,
        "name": site.name,
        "public_origin": origin,
        "preview": True,
        "theme": site.configuration.get("presentation", {}).get("theme", "institutional"),
        "locations": locations,
        **({"menu_version": menu.version} if menu else {}),
    }
