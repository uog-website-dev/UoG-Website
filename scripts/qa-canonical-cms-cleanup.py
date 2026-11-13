"""Remove temporary credentials and disable only canonical QA identities."""
import json,sys
from pathlib import Path
from sprint3_live_review import Review,get_user_model
from apps.authorization.models import UserRoleAssignment
from django.utils import timezone
from django.conf import settings
assert settings.DEBUG
p=Path('/tmp/canonical-cms-session.json');seed=json.loads(p.read_text());config=json.load(sys.stdin)
r=Review.__new__(Review);r.config=lambda key,default=None:config.get(key,default)
token=r.token(config['KC_ADMIN_USERNAME'],config['KC_ADMIN_PASSWORD'],client='admin-cli',realm='master')
for subject in seed['kc_users']:
    assert r.http('PUT','http://keycloak:8080/admin/realms/uog/users/'+subject,token=token,body={'enabled':False})[0]==204
UserRoleAssignment.objects.filter(user_id=seed['member_id'],revoked_at=None).update(revoked_at=timezone.now())
get_user_model().objects.filter(pk=seed['member_id']).update(is_active=False)
p.unlink()
print(json.dumps({'run':seed['run'],'generated_accounts_disabled':len(seed['kc_users']),'memberships_revoked':True,'private_session_removed':True}))
