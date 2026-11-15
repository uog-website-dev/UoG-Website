"""Local review fault injection: only the generated pilot Site's MENUS toggle."""
import json,os
from pathlib import Path
from django.conf import settings
from apps.sites.models import Module
from apps.sites.services.modules import enable_module_for_site,disable_module_for_site
assert settings.DEBUG
seed=json.loads(Path('/tmp/menu-rendering-session.json').read_text())
state=os.environ['QA_MENU_MODULE_STATE'];assert state in ('on','off')
module=Module.objects.get(code='MENUS')
(enable_module_for_site if state=='on' else disable_module_for_site)(seed['site'],module.pk)
print(json.dumps({'site':seed['site'],'menus_enabled':state=='on','result':'PASS'}))
