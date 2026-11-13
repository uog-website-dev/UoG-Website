"""Local-only browser fixture; secrets remain on stdin or mode-0600 /tmp."""
import json, sys
from pathlib import Path
from sprint3_live_review import Review, Site, Module, OrganizationUnit, OrganizationType, ContentRole, enable_module_for_site, activate_site
from django.conf import settings
assert settings.DEBUG
assert not Path("/tmp/post-editor-browser-session.json").exists(), "Clean up the previous article rehearsal first"
config=json.load(sys.stdin)
import time, uuid
r=Review.__new__(Review)
r.run='post-'+uuid.uuid4().hex[:10]
r.users=[];r.profiles={};r.rows=[];r.seed={'profiles':{}}
r.config=lambda key,default=None:config.get(key,default)
r.kc_admin=r.token(config['KC_ADMIN_USERNAME'],config['KC_ADMIN_PASSWORD'],client='admin-cli',realm='master')
root=OrganizationUnit.objects.filter(parent__isnull=True,organization_type__code='UNIVERSITY').first()
org=OrganizationUnit.objects.create(code='P4-'+r.run,name='Article editor QA '+r.run,organization_type=OrganizationType.objects.get(code='COLLEGE'),parent=root)
site=Site.objects.create(code='P4-'+r.run,name='Article editor QA '+r.run,organization_unit=org)
module=Module.objects.get(code='POSTS')
assert module.is_enabled, 'Enable POSTS globally before this local rehearsal'
enable_module_for_site(site.pk,module.pk)
activate_site(site.pk)
r.provision('author','editor',site,ContentRole.AUTHOR)
r.provision('editor','editor',site,ContentRole.AUTHOR)
secret={'site':site.pk,'users':r.users,'profiles':r.profiles,'run':r.run}
p=Path('/tmp/post-editor-browser-session.json');p.write_text(json.dumps(secret));p.chmod(0o600)
print(json.dumps({'site':site.pk,'run':r.run}))
