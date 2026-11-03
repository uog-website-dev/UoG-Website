"""Disable only this driver's dedicated QA identities and restore fixture switches."""
import json
import os
import sys
import urllib.request
import urllib.parse
from pathlib import Path

sys.path.insert(0, '/app')
os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings')
import django
django.setup()
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from apps.authorization.models import UserRoleAssignment
from apps.cms.models import SiteContentRoleAssignment
from apps.sites.models import Module, Site
from apps.organizations.models import OrganizationUnit
from apps.audit.context import audit_context
from apps.audit.writer import record_event

env=json.loads(sys.stdin.read())['kc']
def call(path, method='GET', body=None, token=None, form=None):
    data=urllib.parse.urlencode(form).encode() if form is not None else json.dumps(body).encode() if body is not None else None
    request=urllib.request.Request('http://keycloak:8080'+path,data=data,method=method)
    request.add_header('Content-Type','application/x-www-form-urlencoded' if form is not None else 'application/json')
    if token: request.add_header('Authorization','Bearer '+token)
    with urllib.request.urlopen(request,timeout=20) as response:
        raw=response.read()
        return response.status, json.loads(raw) if raw else None

master=call('/realms/master/protocol/openid-connect/token','POST',form={
    'grant_type':'password','client_id':'admin-cli','username':env['KC_BOOTSTRAP_ADMIN_USERNAME'],'password':env['KC_BOOTSTRAP_ADMIN_PASSWORD']})[1]['access_token']
owned={}
runs=set()
paths=list(Path('/tmp').glob('qa-gate-session*.json'))
for path in paths:
    session=json.loads(path.read_text())
    runs.add(session['run'])
    for actor in session['actors'].values():
        assert actor['username'].startswith(session['run']+'-')
        owned[actor['kc_id']]=actor
for key,actor in owned.items():
    call('/admin/realms/uog/users/'+key,'PUT',{'enabled':False},master)
    call('/admin/realms/uog/users/'+key+'/logout','POST',{},master)
ids=[actor['user_id'] for actor in owned.values()]
state=json.loads(Path('/tmp/qa-gate-results.json').read_text())['state']
with transaction.atomic(), audit_context(actor_id='qa-gate-cleanup'):
    grants=UserRoleAssignment.objects.filter(user_id__in=ids,revoked_at=None).update(revoked_at=timezone.now())
    bindings=SiteContentRoleAssignment.objects.filter(user_id__in=ids).delete()[0]
    get_user_model().objects.filter(pk__in=ids).update(is_active=False)
    for pk,value in state.get('restore_global_modules',{}).items():
        module=Module.objects.get(pk=pk)
        module.is_enabled=value
        module.save(update_fields=['is_enabled'])
    record_event(action='QA_IDENTITIES_DISABLED',entity_type='qa.run',entity_id=state['run'],
                 after={'identities':len(ids),'grants_revoked':grants,'cms_bindings_revoked':bindings},changed_fields=['test_privileges'])
clients=call('/admin/realms/uog/clients?clientId=admin-web',token=master)[1]
report={'date':'2026-11-02','disabled_qa_keycloak_users':len(owned),'revoked_database_grants':grants,
        'removed_qa_cms_bindings':bindings,'secret_files_removed':len(paths),
        'restored_global_module_flags':state.get('restore_global_modules',{}),
        'admin_web_registered_logout_uris':clients[0].get('attributes',{}).get('post.logout.redirect.uris'),
        'retained_qa_sites':[],'retained_qa_organizations':[]}
for run in runs:
    report['retained_qa_sites']+=list(Site.objects.filter(code__startswith=run.upper()).values('id','code','status'))
    report['retained_qa_organizations']+=list(OrganizationUnit.objects.filter(code=run.upper()).values('id','code'))
for path in paths: path.unlink()
Path('/tmp/qa-cleanup.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
