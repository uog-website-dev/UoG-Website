"""Template-declared navigation capabilities, separate from copied Site defaults."""
from django.core.exceptions import ValidationError

MENU_SLOTS = {'header':'Primary Header','secondary':'Utility Header','footer':'Footer','sidebar':'Page Sidebar'}

def default_menu_locations():
    return list(MENU_SLOTS)

def validate_menu_locations(value):
    if not isinstance(value,list) or len(value)>len(MENU_SLOTS) or any(not isinstance(v,str) or v not in MENU_SLOTS for v in value) or len(set(value))!=len(value):
        raise ValidationError('Choose unique supported menu location identifiers.')

def locations_for_site(site):
    return site.template.menu_locations if site.template_id else default_menu_locations()
