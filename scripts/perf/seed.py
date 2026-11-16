"""Development-only, idempotent representative dataset. Config comes via stdin."""
import io,json,sys,uuid
from pathlib import Path
sys.path.insert(0,'/tmp')
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from apps.organizations.models import OrganizationType,OrganizationUnit
from apps.sites.models import Site,SiteDomain,Module
from apps.sites.services.lifecycle import activate_site
from apps.sites.services.modules import enable_module_for_site
from apps.authorization.models import Role,UserRoleAssignment
from apps.cms.models import Page
from apps.api.models import Post,Category,Tag
from apps.cms.menu_models import Menu,MenuItem
from apps.cms.services.pages import create_page
from apps.cms.services.workflow import transition_content
from apps.media.models import MediaAsset
from apps.media.storage import ObjectStorage
from apps.media.services import register_asset,update_asset
from PIL import Image
from sprint3_live_review import Review
assert settings.DEBUG, 'Never seed representative fixtures in production.'
config=json.load(sys.stdin)
counts={k:int(config.get('PERF_'+k.upper(),v)) for k,v in {'sites':10,'pages':40,'posts':100,'media':80}.items()}
assert 10<=counts['sites']<=30 and all(20<=counts[k]<=500 for k in ('pages','posts','media'))
session=Path('/tmp/perf001-session.json')
call_command('seed_rbac',verbosity=0)
parent=OrganizationUnit.objects.get(parent__isnull=True)
kind=OrganizationType.objects.get(code='COLLEGE')
org,_=OrganizationUnit.objects.get_or_create(code='PERF001',defaults={'name':'Performance rehearsal institution','organization_type':kind,'parent':parent})
sites=[]
for i in range(counts['sites']):
 site,_=Site.objects.get_or_create(code=f'PERF001-{i+1:02}',defaults={'name':f'Performance Site {i+1:02}','organization_unit':org})
 assert site.organization_unit_id==org.pk
 if site.status!='ACTIVE':activate_site(site.pk)
 for code in ('PAGES','POSTS','MENUS','MEDIA','VISUAL_BUILDER'):
  module=Module.objects.get(code=code);assert module.is_enabled,f'Enable {code} globally before seeding.'
  enable_module_for_site(site.pk,module.pk)
 SiteDomain.objects.get_or_create(site=site,hostname=f'perf001-{i+1:02}.uog.local',defaults={'is_primary':True,'status':'ACTIVE'})
 sites.append(site)
review=Review.__new__(Review);review.run='perf001-'+uuid.uuid4().hex[:8];review.config=lambda key,default=None:config.get(key,default)
# Bootstrap the managed identity directly through the same authenticated Django
# endpoint; seeding must not require the ordinary frontend/nginx containers.
review_http=review.http
review.http=lambda method,url,**kwargs: review_http(method,url.replace('http://nginx/','http://backend:8000/',1),**kwargs)
review.rows,review.users,review.profiles=[],[],{};review.seed={'profiles':{}}
review.kc_admin=review.token(config['KC_ADMIN_USERNAME'],config['KC_ADMIN_PASSWORD'],client='admin-cli',realm='master')
if session.exists():
 private=json.loads(session.read_text());actor=get_user_model().objects.get(pk=private['actor_id'])
 assert actor.is_active, 'Retired rehearsal principal: provision a new explicit fixture identity.'
else:
 actor=review.provision('site-admin','site-administrator',sites[0])
 private={'actor':review.profiles['site-admin'],'actor_id':actor.pk,'kc_users':review.users,'run':'perf001'}
 session.write_text(json.dumps(private));session.chmod(0o600)
# Dedicated localhost-only benchmark callback; do not widen wildcard redirects.
status,_,clients,_=review.http('GET','http://keycloak:8080/admin/realms/uog/clients?clientId=admin-web',token=review.kc_admin)
assert status==200 and len(clients)==1
client=clients[0];callback='http://localhost:8088/admin/api/auth/callback/keycloak'
private.setdefault('added_callback',callback not in client.get('redirectUris',[]))
private.setdefault('added_origin','http://localhost:8088' not in client.get('webOrigins',[]))
client['redirectUris']=list(dict.fromkeys([*client.get('redirectUris',[]),callback]));client['webOrigins']=list(dict.fromkeys([*client.get('webOrigins',[]),'http://localhost:8088']))
assert review.http('PUT','http://keycloak:8080/admin/realms/uog/clients/'+client['id'],token=review.kc_admin,body=client)[0]==204
session.write_text(json.dumps(private));session.chmod(0o600)
workers={}
for name,role in [('reviewer','reviewer'),('publisher','publisher')]:
 user,_=get_user_model().objects.get_or_create(username='perf001-'+name);user.is_active=True;user.save(update_fields=['is_active']);workers[name]=user
for site in sites:
 for user,role in [(actor,'site-administrator'),(workers['reviewer'],'reviewer'),(workers['publisher'],'publisher')]:
  UserRoleAssignment.objects.get_or_create(user=user,role=Role.objects.get(code=role),site=site,scope='SITE',organization=org)

def promote(content):
 if content.status=='PUBLISHED':return
 for action,user in [('submit',actor),('approve',workers['reviewer']),('publish',workers['publisher'])]:
  content=transition_content(content.pk,action=action,actor=user,comment='Performance dataset approved fixture')

storage=ObjectStorage()
for site in sites:
 categories=[Category.objects.get_or_create(site=site,name=f'Topic {i}',slug=f'perf-topic-{i}',defaults={'code':f'PERF_TOPIC_{i}'})[0] for i in range(5)]
 tags=[Tag.objects.get_or_create(site=site,name=f'Tag {i}',slug=f'perf-tag-{i}',defaults={'code':f'PERF_TAG_{i}'})[0] for i in range(10)]
 for i in range(counts['pages']):
  slug=f'perf-page-{i:03}';page=Page.objects.filter(site=site,slug=slug).first()
  if not page:
   page=create_page(site=site,title=f'Institutional information {i:03}',slug=slug,actor=actor,blocks=[{'type':'heading','text':f'Information {i:03}','level':2},{'type':'paragraph','html':'<p>'+('University information for students, researchers and the community. '*60)+'</p>'}])
  if i%5==0:promote(page)
 for i in range(counts['posts']):
  slug=f'perf-post-{i:03}';post=Post.objects.filter(site=site,slug=slug).first()
  if not post:
   post=Post(site=site,title=f'University news item {i:03}',slug=slug,excerpt='Research, education and community engagement at the university.',content='<p>'+('Institutional news and updates for the university community. '*60)+'</p>',author=actor,created_by=actor,updated_by=actor);post.save();post.categories.add(categories[i%5]);post.tags.add(tags[i%10],tags[(i+1)%10])
  if i%5==0:promote(post)
 for i in range(counts['media']):
  reference=f'platform-private:sites/{site.pk}/perf001/image-{i:03}.jpg'
  asset=MediaAsset.objects.filter(storage_reference=reference).first()
  if not asset:
   stream=io.BytesIO();Image.new('RGB',(640,400),((i*17)%255,(i*39)%255,(i*61)%255)).save(stream,format='JPEG',quality=85);stream.seek(0)
   storage.put('platform-private',reference.split(':',1)[1],stream,content_type='image/jpeg')
   asset=register_asset(actor,site.pk,storage_reference=reference,original_filename=f'campus-{i:03}.jpg',storage=storage)
  if asset.status=='PENDING':update_asset(actor,site.pk,asset.pk,changes={'status':'READY','alt_text':f'Approved campus illustration {i:03}','categories':['Campus']})
 for i in range(4):
  menu,_=Menu.objects.get_or_create(site=site,code=f'perf001-{i}',defaults={'name':f'Institutional navigation {i}','location':''})
  for j in range(12):MenuItem.objects.get_or_create(menu=menu,site=site,sort_order=j,defaults={'label':f'Information destination {j:02}','item_type':'custom','target':f'/perf-page-{j:03}'})
 print(json.dumps({'event':'perf.seed.progress','site':site.pk,'pages':Page.objects.filter(site=site).count(),'posts':Post.objects.filter(site=site).count(),'media':MediaAsset.objects.filter(site=site).count()}),flush=True)
for user in workers.values():
 UserRoleAssignment.objects.filter(user=user).delete();user.is_active=False;user.save(update_fields=['is_active'])
private.update({'sites':[{'id':s.pk,'name':s.name,'code':s.code} for s in sites],'counts_per_site':counts})
session.write_text(json.dumps(private));session.chmod(0o600)
print(json.dumps({'event':'perf.seed.complete','sites':len(sites),'counts_per_site':counts,'private_session':str(session)}))
