"""Provision a fresh issuer-bound QA principal after restoring standard ports."""
import sys,json
from pathlib import Path
sys.path.insert(0,'/tmp')
from sprint3_live_review import Review,Site
from django.conf import settings
assert settings.DEBUG
path=Path('/tmp/menu-locations-session.json');seed=json.loads(path.read_text());config=json.load(sys.stdin)
r=Review.__new__(Review);r.rows=[];r.users=[];r.profiles={};r.seed={'profiles':{}};r.run=seed['run']+'-standard';r.config=lambda key,default=None:config.get(key,default)
r.kc_admin=r.token(config['KC_ADMIN_USERNAME'],config['KC_ADMIN_PASSWORD'],client='admin-cli',realm='master')
user=r.provision('admin','site-administrator',Site.objects.get(pk=seed['site']))
seed['member_ids']=[seed['member_id'],user.pk];seed['kc_users']+=r.users;seed['member']=r.profiles['admin'];seed['member_id']=user.pk
path.write_text(json.dumps(seed));path.chmod(0o600)
print(json.dumps({'result':'PASS','issuer':settings.OIDC_ISSUER,'fresh_review_principal':True}))
