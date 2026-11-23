"""Scoped draft/publication services for template menu locations."""
from django.core.exceptions import ValidationError
from apps.audit.writer import record_event
from apps.sites.models import Site
from apps.sites.menu_locations import MENU_SLOTS,locations_for_site
from ..menu_models import Menu
from ..menu_assignment_models import MenuLocationAssignment
from ..menu_cache import invalidate_menu_state
from .menus import _operation,authorize_menu,MenuConflict

def location_state(site):
    rows={r.location:r for r in MenuLocationAssignment.objects.filter(site=site)}
    result=[]
    for location in locations_for_site(site):
        row=rows.get(location)
        legacy=Menu.objects.filter(site=site,location=location,is_active=True,is_global=False).first()
        public=row.published_menu_id if row and row.is_published else legacy.pk if legacy else None
        draft=row.draft_menu_id if row else public
        result.append({'location':location,'label':MENU_SLOTS[location],'version':row.version if row else 0,'draft_menu':str(draft) if draft else None,'published_menu':str(public) if public else None,'is_published':bool(row and row.is_published),'draft_menus':row.draft_menus if row else [],'published_menus':row.published_menus if row and row.is_published else [],'has_changes':draft!=public or bool(row and (not row.is_published or row.draft_menus!=row.published_menus))})
    return result

def write_location(site_id,location,*,actor,expected,menu_id=None,replace=False,publish=False,menu_ids=None):
    with _operation(actor):
        authorize_menu(actor,site_id,permission='menu.publish' if publish else 'menu.write')
        site=Site.objects.select_related('template').get(pk=site_id)
        if location not in locations_for_site(site):
            raise ValidationError({'location':'This location is not supported by the Site template.'})
        row=MenuLocationAssignment.objects.filter(site=site,location=location).first()
        if expected!=(row.version if row else 0):raise MenuConflict('version_conflict')
        before=next(value for value in location_state(site) if value['location']==location)
        if menu_ids is not None and location != 'footer':
            raise ValidationError({'menus':'Multiple menus are supported only for Footer.'})
        if publish:
            if row is None:raise ValidationError({'location':'Save the assignment draft before publishing.'})
            if row.draft_menu_id and not Menu.objects.filter(pk=row.draft_menu_id,site=site,is_active=True,is_global=False).exists():
                raise ValidationError({'menu':'Publish the selected same-Site menu before publishing its assignment.'})
            if row.draft_menus and Menu.objects.filter(pk__in=row.draft_menus,site=site,is_active=True,is_global=False).count()!=len(row.draft_menus):
                raise ValidationError({'menus':'Publish every selected same-Site menu first.'})
            row.published_menus=list(row.draft_menus)
            row.published_menu_id=row.draft_menu_id;row.is_published=True
        else:
            if menu_ids is not None:
                menu_ids=[str(value) for value in menu_ids]
                if len(menu_ids)>4 or len(set(menu_ids))!=len(menu_ids):
                    raise ValidationError({'menus':'Choose up to four distinct footer menus.'})
                if Menu.objects.filter(pk__in=menu_ids,site=site,is_global=False).count()!=len(menu_ids):
                    raise ValidationError({'menus':'Choose local menus owned by this Site.'})
                menu_id=menu_ids[0] if menu_ids else None
            menu=Menu.objects.filter(pk=menu_id,site=site,is_global=False).first() if menu_id else None
            if menu_id and menu is None:raise ValidationError({'menu':'Choose a local menu owned by this Site.'})
            current=before['draft_menu'] or before['published_menu']
            if menu_id and current and str(menu_id)!=current and not replace:
                raise MenuConflict('replacement_required')
            if row is None:row=MenuLocationAssignment(site=site,location=location)
            row.draft_menu=menu
            row.draft_menus=menu_ids if menu_ids is not None else []
        row.updated_by=actor;row.save()
        after=next(value for value in location_state(site) if value['location']==location)
        record_event(action='MENU_LOCATION_PUBLISHED' if publish else 'MENU_LOCATION_DRAFT_SAVED',entity_type='cms.menu_location',entity_id=row.pk,before={'site_id':site.pk,**before},after={'site_id':site.pk,**after},changed_fields=['published_menu' if publish else 'draft_menu'])
        if publish:invalidate_menu_state(site.pk,location,False)
        return after
