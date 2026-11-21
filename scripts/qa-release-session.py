"""Disposable read-only browser-review identities; credentials travel on private stdin/stdout only."""
import json,sys,uuid
from pathlib import Path
from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone
from apps.sites.models import Site
from apps.authorization.models import UserRoleAssignment
assert settings.DEBUG
sys.path.insert(0,'/tmp')
from sprint3_live_review import Review
config=json.load(sys.stdin);phase=sys.argv[-1];p=Path('/tmp/p4-release-session.json')
r=Review.__new__(Review);r.config=lambda k,default=None:config.get(k,default)
if phase=='prepare':
 assert not p.exists(),'Retain and reconcile existing private review journal'
 main=Site.objects.get(is_main=True,status='ACTIVE');pilot=Site.objects.get(code=config.get('QA_PILOT_SITE_CODE','CAES'),is_main=False,status='ACTIVE')
 r.run='p4gate-'+uuid.uuid4().hex[:8];r.users=[];r.profiles={};r.seed={'profiles':{}};r.rows=[]
 data={'run':r.run,'users':r.users,'profiles':r.profiles,'sites':{'main':main.pk,'college':pilot.pk}}
 r.kc_admin=r.token(config['KC_ADMIN_USERNAME'],config['KC_ADMIN_PASSWORD'],client='admin-cli',realm='master')
 p.write_text(json.dumps(data));p.chmod(0o600)
 for label,site in [('main',main),('college',pilot)]:
  try:r.provision(label,'editor',site)
  finally:p.write_text(json.dumps(data));p.chmod(0o600)
 print(json.dumps({'run':r.run,'generated_profiles':len(r.profiles),'editorial_writes':False}))
elif phase=='refresh':
 data=json.loads(p.read_text());
 for profile in data['profiles'].values():profile['token']=r.token(profile['username'],profile['password'])
 p.write_text(json.dumps(data));p.chmod(0o600);print(json.dumps(data))
elif phase=='cleanup':
 data=json.loads(p.read_text());assert data['run'].startswith('p4gate-')
 r.kc_admin=r.token(config['KC_ADMIN_USERNAME'],config['KC_ADMIN_PASSWORD'],client='admin-cli',realm='master')
 for identifier in data['users']:
  status,_,body,_=r.http('GET',f'http://keycloak:8080/admin/realms/uog/users/{identifier}',token=r.kc_admin)
  assert status==200 and body['username'].startswith('s3-'+data['run']+'-')
  status,_,_,_=r.http('PUT',f'http://keycloak:8080/admin/realms/uog/users/{identifier}',token=r.kc_admin,body={'enabled':False});assert status==204
 users=get_user_model().objects.filter(username__in=[x['username'] for x in data['profiles'].values()]);assert users.count()==len(data['profiles'])
 for label,profile in data['profiles'].items():
  assert not UserRoleAssignment.objects.filter(user__username=profile['username']).exclude(scope='SITE',site_id=data['sites'][label]).exists()
 revoked=UserRoleAssignment.objects.filter(user__in=users,revoked_at__isnull=True).update(revoked_at=timezone.now());disabled=users.update(is_active=False)
 p.unlink();print(json.dumps({'disabled':disabled,'revoked':revoked,'private_journal_removed':True,'editorial_writes':False}))
else:raise ValueError('Use prepare, refresh or cleanup')
