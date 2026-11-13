"""Disable only this rehearsal's generated identities and remove its secret file."""
import json, sys
from pathlib import Path
from sprint3_live_review import Review, get_user_model
from django.conf import settings
assert settings.DEBUG
config=json.load(sys.stdin)
p=Path('/tmp/post-editor-browser-session.json')
seed=json.loads(p.read_text())
r=Review.__new__(Review)
r.config=lambda key,default=None:config.get(key,default)
token=r.token(config['KC_ADMIN_USERNAME'],config['KC_ADMIN_PASSWORD'],client='admin-cli',realm='master')
statuses=[r.http('PUT',f'http://keycloak:8080/admin/realms/uog/users/{identifier}',token=token,body={'enabled':False})[0] for identifier in seed['users']]
assert all(code==204 for code in statuses), 'Generated identity cleanup did not complete'
local=get_user_model().objects.filter(username__in=[profile['username'] for profile in seed['profiles'].values()]).update(is_active=False)
p.unlink()
print(json.dumps({'run':seed['run'],'site':seed['site'],'generated_keycloak_accounts_disabled':len(statuses),'generated_local_accounts_disabled':local,'secret_file_removed':True}))
