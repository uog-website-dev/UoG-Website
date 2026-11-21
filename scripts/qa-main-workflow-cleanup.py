"""Disable only generated review identities; retain Main Site and published QA content."""
import json,sys
from pathlib import Path
from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone
from django.db import transaction
from apps.authorization.models import UserRoleAssignment
from apps.sites.models import Site
assert settings.DEBUG
sys.path.insert(0,'/tmp')
from sprint3_live_review import Review
config=json.load(sys.stdin)
p=Path('/tmp/main-workflow-session.json');data=json.loads(p.read_text(encoding='utf-8'))
site=Site.objects.get(pk=data['site'],code='MAIN',status='ACTIVE')
assert data['run'].startswith('mainqa-')
profiles=data['profiles'];names=[v['username'] for v in profiles.values()]
assert all(n.startswith('s3-'+data['run']+'-') for n in names)
r=Review.__new__(Review);r.config=lambda k,default=None:config.get(k,default)
r.kc_admin=r.token(config['KC_ADMIN_USERNAME'],config['KC_ADMIN_PASSWORD'],client='admin-cli',realm='master')
remote=[]
for identifier in data['users']:
 # Resolve and verify ownership before disabling a provider identity.
 status,_,body,_=r.http('GET',f'http://keycloak:8080/admin/realms/uog/users/{identifier}',token=r.kc_admin)
 assert status==200 and body['username'].startswith('s3-'+data['run']+'-')
 status,_,_,_=r.http('PUT',f'http://keycloak:8080/admin/realms/uog/users/{identifier}',token=r.kc_admin,body={'enabled':False})
 assert status==204
 remote.append(identifier)
users=get_user_model().objects.filter(username__in=names)
assert users.count()==len(profiles)
assignments=UserRoleAssignment.objects.filter(user__in=users)
assert not assignments.exclude(scope='SITE',site=site).exists()
with transaction.atomic():
 revoked=assignments.filter(revoked_at__isnull=True).update(revoked_at=timezone.now())
 disabled=users.update(is_active=False)
assert not users.filter(is_active=True).exists()
p.unlink()
print(json.dumps({'run':data['run'],'provider_identities_disabled':len(remote),'database_identities_disabled':disabled,'memberships_revoked':revoked,'private_session_removed':not p.exists(),'main_site_status':site.status,'published_content_retained':True}))
