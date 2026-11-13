"""Verify real Site grants after browser provisioning; no tokens in evidence."""
import json,sys,secrets
from pathlib import Path
from sprint3_live_review import Review
from apps.accounts.models import OIDCIdentity
from apps.authorization.models import Role,AuthorizationAuditEvent,UserRoleAssignment
from django.contrib.auth import get_user_model
config=json.load(sys.stdin)
path=Path('/tmp/site-user-browser-session.json');seed=json.loads(path.read_text())
r=Review.__new__(Review);r.rows=[];r.config=lambda key,default=None:config.get(key,default)
admin_token=r.token(seed['admin']['username'],seed['admin']['password'])
staff_token=r.token(seed['staff']['username'],seed['staff']['password'])
root_token=r.token(config.get('KEYCLOAK_DEV_USERNAME','devuser'),config['KEYCLOAK_DEV_PASSWORD'])
base='http://nginx/api/v1/authorization/'
def api(method,path,token,body=None):
    return r.http(method,base+path,token=token,body=body,headers={'Host':'localhost'})
staff=get_user_model().objects.get(username=seed['staff']['username'])
seed['users'].append(staff.pk)
seed['subjects'].append(OIDCIdentity.objects.get(user=staff).subject)
path.write_text(json.dumps(seed));path.chmod(0o600)
new={'username':seed['run']+'-denied','email':seed['run']+'-denied@example.edu','password':secrets.token_urlsafe(24)+'!8','site':seed['site'],'role':Role.objects.get(code='editor').pk}
new['password_confirmation']=new['password']
r.expect('Site A administrator cannot create for Main Site',api('POST','assignments/site-create-user/',admin_token,{**new,'site':seed['foreign_site']}),403)
r.expect('Editor cannot create identities directly',api('POST','assignments/site-create-user/',staff_token,new),403)
r.expect('Site role is required',api('POST','assignments/site-create-user/',admin_token,{k:v for k,v in new.items() if k!='role'}),400)
r.expect('Unsafe picture bytes rejected',api('POST','assignments/site-create-user/',admin_token,{**new,'profile_picture':'PHNjcmlwdD5iYWQ8L3NjcmlwdD4='}),400)
r.expect('Duplicate account cannot leave an assignment',api('POST','assignments/site-create-user/',admin_token,{**new,'username':seed['staff']['username'],'email':seed['staff']['email']}),400)
permissions=r.expect('New editor authenticates and resolves Site permissions',api('GET',f"me/permissions/?scope=SITE&site={seed['site']}",staff_token),200)
r.check('Only scoped Editor permissions are effective','content.posts.update' in permissions['permissions'] and 'platform.users.assign_roles' not in permissions['permissions'])
r.expect('Site administrator cannot read foreign directory',api('GET',f"assignments/site-users/?site={seed['foreign_site']}",admin_token),403)
role=Role.objects.get(code='reviewer')
organization_id=UserRoleAssignment.objects.get(user=staff,role__code='editor',site_id=seed['site']).organization_id
r.expect('Existing identity can still receive another Site role',api('POST','assignments/',admin_token,{'user':staff.pk,'role':role.pk,'scope':'SITE','site':seed['site'],'organization':organization_id}),201)
from apps.sites.models import Site
main=Site.objects.get(pk=seed['foreign_site'])
r.expect('Site administrator cannot assign existing identity to Main Site',api('POST','assignments/',admin_token,{'user':staff.pk,'role':role.pk,'scope':'SITE','site':main.pk,'organization':main.organization_unit_id}),403)
main_user={**new,'username':seed['run']+'-main','email':seed['run']+'-main@example.edu','site':main.pk,'role':Role.objects.get(code='viewer').pk}
created=r.expect('Shared provisioning works on Main Site without picture',api('POST','assignments/site-create-user/',root_token,main_user),201)
seed['users'].append(created['user']);seed['subjects'].append(OIDCIdentity.objects.get(user_id=created['user']).subject)
path.write_text(json.dumps(seed));path.chmod(0o600)
directory=r.expect('Main Site directory returns safe omitted-picture fallback',api('GET',f'assignments/site-users/?site={main.pk}',root_token),200)
row=next(row for row in directory['results'] if row['user']==created['user'])
r.check('Omitted picture has no broken image URL',row['profile_picture']=='')
events=AuthorizationAuditEvent.objects.filter(subject_user_id=str(staff.pk),site_id=str(seed['site']),actor__username=seed['admin']['username'])
r.check('Creation and assignment audit include actor Site and role',{'SITE_USER_CREATED','ROLE_ASSIGNED'} <= set(events.values_list('action',flat=True)) and events.filter(role_code='editor',outcome='CHANGE').exists())
print(json.dumps({'run':seed['run'],'site':seed['site'],'main_site':main.pk,'results':r.rows}))
