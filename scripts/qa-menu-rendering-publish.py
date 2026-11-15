"""Promote reviewed fixture data through the existing publisher services."""
import sys,json
from pathlib import Path
sys.path.insert(0,'/tmp')
from apps.cms.models import Menu,MenuLocationAssignment
from apps.cms.services.menus import set_menu_active,menu_etag
from apps.cms.services.menu_locations import write_location
from django.contrib.auth import get_user_model
from django.conf import settings
assert settings.DEBUG
seed=json.loads(Path('/tmp/menu-rendering-session.json').read_text());actor=get_user_model().objects.get(pk=seed['publisher_id'])
menu=Menu.objects.get(pk=seed['menus']['Primary replacement'])
set_menu_active(menu.pk,actor=actor,expected=menu_etag(menu),active=True)
for row in MenuLocationAssignment.objects.filter(site_id=seed['site']):
    write_location(seed['site'],row.location,actor=actor,expected=row.version,publish=True)
print(json.dumps({'result':'PASS','site':seed['site'],'promoted_locations':4,'publisher_role':'publisher'}))
