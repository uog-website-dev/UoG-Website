"""Real authenticated HTTP isolation matrix; read-only baseline IDs, denied writes only."""
import json,sys
from pathlib import Path
from django.conf import settings
from django.contrib.auth import get_user_model
from apps.sites.models import Site
from apps.cms.models import Page
from apps.api.models import Post
from apps.cms.menu_models import Menu
from apps.cms.sidebar_models import Sidebar
from apps.media.models import MediaAsset
from apps.authorization.models import UserRoleAssignment
assert settings.DEBUG
sys.path.insert(0,'/tmp')
from sprint3_live_review import Review
config=json.load(sys.stdin);p=Path('/tmp/college-workflow-session.json');data=json.loads(p.read_text())
r=Review.__new__(Review);r.run=data['run'];r.users=data['users'];r.profiles=data['profiles'];r.rows=[];r.seed={'profiles':{}};r.config=lambda k,default=None:config.get(k,default)
r.kc_admin=r.token(config['KC_ADMIN_USERNAME'],config['KC_ADMIN_PASSWORD'],client='admin-cli',realm='master')
main=Site.objects.get(is_main=True,status='ACTIVE');college=Site.objects.get(pk=data['site'],is_main=False,status='ACTIVE')
if 'main-observer' not in r.profiles:
 try:r.provision('main-observer','site-administrator',main)
 finally:p.write_text(json.dumps(data));p.chmod(0o600)
for profile in r.profiles.values():profile['token']=r.token(profile['username'],profile['password'])
p.write_text(json.dumps(data));p.chmod(0o600)
for role,site in [('admin',college),('main-observer',main)]:
 user=get_user_model().objects.get(username=r.profiles[role]['username'])
 assert not UserRoleAssignment.objects.filter(user=user,revoked_at__isnull=True).exclude(scope='SITE',site=site).exists()
rows=[];trace=[]
def call(method,path,role,body=None,headers=None):
 response=r.http(method,'http://nginx'+path,token=r.profiles[role]['token'],body=body,headers={'Host':'localhost',**(headers or {})})
 trace.append({'method':method,'path':path.split('?')[0],'status':response[0],'request_id':response[1].get('X-Request-ID')})
 return response
def record(case,status,allowed):
 rows.append({'case':case,'status':status,'expected_status':allowed,'pass':status in allowed})
 assert status in allowed,(case,status)
for owner,foreign,authorized,attacker in [(main,college,'main-observer','admin'),(college,main,'admin','main-observer')]:
 models=[('pages',Page,{'title':'Forbidden foreign Page'}),('posts',Post,{'title':'Forbidden foreign Post'}),('menus',Menu,{'name':'Forbidden foreign menu'}),('sidebars',Sidebar,{'name':'Forbidden foreign sidebar'}),('assets',MediaAsset,{'alt_text':'Forbidden foreign asset'})]
 for resource,model,body in models:
  qs=model.objects.filter(site=owner)
  if resource in ['pages','posts']:qs=qs.filter(status='PUBLISHED')
  elif resource=='sidebars':qs=qs.filter(status='ACTIVE')
  elif resource=='assets':qs=qs.filter(status='READY')
  row=qs.order_by('pk').first();assert row,f'Missing {owner.code} {resource} fixture'
  path=f'/api/v1/sites/{owner.pk}/{resource}/{row.pk}/'
  status,headers,_,_=call('GET',path,authorized);assert status==200,(resource,status)
  for method,payload in [('GET',None),('PATCH',body)]:
   status,_,_,_=call(method,path,attacker,payload,{'If-Match':headers.get('ETag','"unused"')})
   record(f'{attacker}: {method} foreign {owner.code} {resource}',status,[403,404])
  status,_,_,_=call('GET',f'/api/v1/sites/{foreign.pk}/{resource}/{row.pk}/',attacker)
  record(f'{attacker}: foreign {resource} ID in own Site path',status,[403,404])
 page=Page.objects.get(pk=owner.homepage_id)
 status,_,_,_=call('POST',f'/api/v1/sites/{owner.pk}/pages/{page.pk}/homepage/',attacker,{})
 record(f'{attacker}: assign foreign Site homepage',status,[403,404])
 status,_,_,_=call('POST',f'/api/v1/sites/{foreign.pk}/pages/{page.pk}/homepage/',attacker,{})
 record(f'{attacker}: assign foreign Page as own homepage',status,[403,404])
# Forged references in an authorized college write must fail atomically.
counts_before={'pages':Page.objects.filter(site=college).count(),'posts':Post.objects.filter(site=college).count(),'sidebars':Sidebar.objects.filter(site=college).count()}
foreign_image=MediaAsset.objects.filter(site=main,status='READY',detected_mime__startswith='image/').first();assert foreign_image
status,_,body,_=call('POST',f'/api/v1/sites/{college.pk}/posts/','admin',{'title':'Rejected foreign media','slug':data['run']+'-rejected-foreign-media','featured_media':f'sites/{college.pk}/assets/{foreign_image.pk}','featured_alt':'Invalid foreign image','editor_document':{'schema_version':1,'html':'<p>Rejected reference test.</p>'}})
record('Authorized college create with forged Main asset ID',status,[400])
assert 'featured_media' in str(body),str(body)
foreign_menu=Menu.objects.filter(site=main,is_active=True,is_global=False).first();assert foreign_menu
status,_,body,_=call('POST',f'/api/v1/sites/{college.pk}/sidebars/','admin',{'name':'Rejected foreign menu','components':[{'id':'forgedMenu','type':'menu','menu_id':str(foreign_menu.pk)}]})
record('Authorized college sidebar create with Main menu ID',status,[400])
foreign_sidebar=Sidebar.objects.filter(site=main,status='ACTIVE').first();assert foreign_sidebar
status,_,body,_=call('POST',f'/api/v1/sites/{college.pk}/pages/','admin',{'title':'Rejected foreign sidebar','slug':data['run']+'-rejected-sidebar','layout':'RIGHT_SIDEBAR','sidebar':str(foreign_sidebar.pk),'blocks':[]})
record('Authorized college Page create with Main sidebar ID',status,[400])
assert 'sidebar' in str(body),'Expected field-addressed sidebar rejection'
counts_after={'pages':Page.objects.filter(site=college).count(),'posts':Post.objects.filter(site=college).count(),'sidebars':Sidebar.objects.filter(site=college).count()}
assert counts_before==counts_after,'Rejected foreign reference left a partial row'
# Live module disable/re-enable uses the canonical dependency-aware service.
from apps.sites.models import Module
from apps.sites.services.modules import disable_module_for_site,enable_module_for_site
module=Module.objects.get(code='POSTS');original=college.site_modules.get(module=module).is_enabled
assert original
try:
 disable_module_for_site(college.pk,module.pk)
 status,_,module_body,_=call('POST',f'/api/v1/sites/{college.pk}/posts/','admin',{'title':'Blocked module write','slug':data['run']+'-disabled'})
 record('Disabled college POSTS blocks direct create',status,[400])
 assert 'POSTS module is not enabled' in str(module_body),'Expected module-specific denial'
finally:enable_module_for_site(college.pk,module.pk)
assert college.site_modules.get(module=module).is_enabled
# Host resolution must not accept a forged tenant parameter or unknown Host.
for route in ['/api/v1/site-context/','/api/v1/site-context/homepage/']:
 status,_,body,_=r.http('GET','http://nginx'+route,headers={'Host':'unknown-'+data['run']+'.uog.local'})
 record('unknown hostname '+route,status,[404])
print(json.dumps({'run':data['run'],'rows':rows,'all_pass':all(x['pass'] for x in rows),'rejected_writes_atomic':counts_before==counts_after,'trace':trace},indent=2))
