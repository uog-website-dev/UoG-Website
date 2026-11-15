"""Retire the generated principal; retain the representative dataset for reruns."""
import json,sys
from pathlib import Path
sys.path.insert(0,'/tmp')
from django.conf import settings
from django.utils import timezone
from django.contrib.auth import get_user_model
from apps.authorization.models import UserRoleAssignment
from sprint3_live_review import Review
assert settings.DEBUG
session=Path('/tmp/perf001-session.json');data=json.loads(session.read_text());config=json.load(sys.stdin)
actor=get_user_model().objects.get(pk=data['actor_id']);assert actor.username.startswith('s3-perf001-')
review=Review.__new__(Review);review.config=lambda key,default=None:config.get(key,default)
token=review.token(config['KC_ADMIN_USERNAME'],config['KC_ADMIN_PASSWORD'],client='admin-cli',realm='master')
for subject in data['kc_users']:
 assert review.http('PUT','http://keycloak:8080/admin/realms/uog/users/'+subject,token=token,body={'enabled':False})[0]==204
revoked=UserRoleAssignment.objects.filter(user=actor,revoked_at=None).update(revoked_at=timezone.now())
actor.is_active=False;actor.save(update_fields=['is_active'])
status,_,clients,_=review.http('GET','http://keycloak:8080/admin/realms/uog/clients?clientId=admin-web',token=token)
assert status==200 and len(clients)==1
client=clients[0]
if data.get('added_callback'):client['redirectUris']=[v for v in client.get('redirectUris',[]) if v!='http://localhost:8088/admin/api/auth/callback/keycloak']
if data.get('added_origin'):client['webOrigins']=[v for v in client.get('webOrigins',[]) if v!='http://localhost:8088']
assert review.http('PUT','http://keycloak:8080/admin/realms/uog/clients/'+client['id'],token=token,body=client)[0]==204
session.unlink()
print(json.dumps({'principal_disabled':True,'memberships_revoked':revoked,'private_session_removed':True,'dataset_retained':True}))
