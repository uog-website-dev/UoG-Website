"""Local real-provider onboarding rehearsal. Credentials only on stdin/tmp."""
import json,sys,secrets,time,uuid
from pathlib import Path
from urllib.parse import urlencode
from sprint3_live_review import Review,Site,OrganizationUnit,OrganizationType,activate_site
from apps.authorization.models import Role,UserRoleAssignment
from django.conf import settings
assert settings.DEBUG
path=Path('/tmp/site-user-browser-session.json')
assert not path.exists(),"Clean up the prior Site user rehearsal first"
config=json.load(sys.stdin)
r=Review.__new__(Review);r.rows=[];r.config=lambda key,default=None:config.get(key,default)
run='staff-'+uuid.uuid4().hex[:10]
root=OrganizationUnit.objects.filter(parent__isnull=True,organization_type__code='UNIVERSITY').first()
owner=OrganizationUnit.objects.create(code=run.upper(),name='Staff onboarding QA '+run,organization_type=OrganizationType.objects.get(code='COLLEGE'),parent=root)
site=Site.objects.create(organization_unit=owner,code=run.upper(),name='Staff onboarding '+run)
activate_site(site.pk)
other=Site.objects.filter(is_main=True).first()
assert other and other.pk!=site.pk
admin={'username':run+'-admin','email':run+'-admin@example.edu','password':secrets.token_urlsafe(24)+'!8'}
staff={'username':run+'-editor','email':run+'-editor@example.edu','password':secrets.token_urlsafe(24)+'!8'}
token=r.token(config.get('KEYCLOAK_DEV_USERNAME','devuser'),config['KEYCLOAK_DEV_PASSWORD'])
endpoint='http://nginx/api/v1/authorization/assignments/site-create-user/'
body={**admin,'password_confirmation':admin['password'],'site':site.pk,'role':Role.objects.get(code='site-administrator').pk}
created=r.expect('Platform provisions a Site-only administrator',r.http('POST',endpoint,token=token,body=body,headers={'Host':'localhost'}),201)
session={'run':run,'site':site.pk,'foreign_site':other.pk,'admin':admin,'staff':staff,'users':[created['user']],'subjects':[]}
from apps.accounts.models import OIDCIdentity
session['subjects'].append(OIDCIdentity.objects.get(user_id=created['user']).subject)
path.write_text(json.dumps(session));path.chmod(0o600)
grant=r.http('POST','http://keycloak:8080/realms/uog/protocol/openid-connect/token',body=urlencode({'grant_type':'password','client_id':'backend-api','client_secret':config['KEYCLOAK_BACKEND_API_SECRET'],'username':admin['username'],'password':admin['password']}).encode(),headers={'Content-Type':'application/x-www-form-urlencoded'})
print(json.dumps({'run':run,'site':site.pk,'foreign_site':other.pk,'initial_login_status':grant[0],'login_rule':grant[2].get('error_description','credentials accepted') if grant[0]!=200 else 'credentials accepted','results':r.rows}))
