"""Private previews use authenticated Site context, never public cache entries."""
from apps.sites.menu_locations import locations_for_site
from apps.cms.menu_models import Menu,MenuInheritance
from apps.cms.menu_assignment_models import MenuLocationAssignment
from apps.cms.selectors.menu_delivery import compose_location,_project
from .menus import authorize_menu,authorize_central_menu
from django.core.exceptions import ValidationError


def preview_navigation(site,*,actor,menu=None):
    authorize_menu(actor,site.pk,edit=True)
    if menu and menu.site_id!=site.pk:
        raise ValidationError({'menu':'Choose a menu owned by this Site.'})
    if menu and menu.is_global:authorize_central_menu(actor)
    from ..menu_destinations import menu_origin
    origin=menu_origin(site.pk)
    if menu:
        locations={menu.location if menu.location in locations_for_site(site) else 'header':_project(menu,'local',draft=True)}
    else:
        locations={}
        rows={r.location:r for r in MenuLocationAssignment.objects.filter(site=site).select_related('draft_menu')}
        for location in locations_for_site(site):
            if location in rows:
                chosen=rows[location].draft_menu
                if chosen and (chosen.site_id!=site.pk or chosen.is_global):raise ValidationError({'menu':'Choose a local menu owned by this Site.'})
                locations[location]=_project(chosen,'local',draft=True)
                continue
            local=Menu.objects.filter(site=site,location=location,is_global=False).first()
            public=compose_location(site.pk,location)
            inherited=[node for node in public if node['source']!='local']
            policy=MenuInheritance.objects.filter(site=site,location=location).first()
            if local and (not policy or policy.local_precedence=='override'):
                inherited=[node for node in inherited if node['source']!='inherited']
            locations[location]=inherited+_project(local,'local',draft=True)
    return {'site':site.pk,'name':site.name,'public_origin':origin,'preview':True,'theme':site.configuration.get('presentation',{}).get('theme','institutional'),'locations':locations,**({'menu_version':menu.version} if menu else {})}
