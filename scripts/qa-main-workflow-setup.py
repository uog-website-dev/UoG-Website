"""Prepare Main Site prerequisites only. All editorial writes belong to the UI driver."""
import json,sys,uuid
from pathlib import Path
from django.conf import settings
from apps.sites.models import Site,Module
from apps.sites.services.modules import enable_module_for_site
sys.path.insert(0,'/tmp')
from sprint3_live_review import Review
assert settings.DEBUG
config=json.load(sys.stdin)
p=Path('/tmp/main-workflow-session.json')
assert not p.exists(),'Existing Main workflow session must be reviewed before another run'
site=Site.objects.get(code='MAIN',status='ACTIVE')
r=Review.__new__(Review);r.run='mainqa-'+uuid.uuid4().hex[:8];r.rows=[];r.users=[];r.profiles={};r.seed={'profiles':{}};r.config=lambda key,default=None:config.get(key,default)
r.kc_admin=r.token(config['KC_ADMIN_USERNAME'],config['KC_ADMIN_PASSWORD'],client='admin-cli',realm='master')
from apps.authorization.models import Role
roles=[('admin','site-administrator'),('editor','editor'),('reviewer','reviewer'),('publisher','publisher'),('viewer','viewer')]
assert all(Role.objects.filter(code=role,is_active=True).exists() for _,role in roles),'Required active role is missing'
original_modules=list(site.site_modules.values('module__code','is_enabled'))
for code in ['PAGES','POSTS','MEDIA','MENUS','VISUAL_BUILDER']:
 module=Module.objects.get(code=code,status='IMPLEMENTED',is_enabled=True)
 enable_module_for_site(site.pk,module.pk)
host=site.domains.get(is_primary=True,status='ACTIVE').hostname
from apps.cms.models import Page
old=Page.objects.filter(pk=site.homepage_id).values('id','title','slug').first()
state={'run':r.run,'site':site.pk,'host':host,'profiles':r.profiles,'users':r.users,'original_modules':original_modules,'original_homepage':old}
def journal():
 p.write_text(json.dumps(state,default=str));p.chmod(0o600)
journal()
for name,role in roles:
 try:r.provision(name,role,site)
 finally:journal()
from PIL import Image,ImageDraw
im=Image.new('RGB',(1000,600),'#12476c');draw=ImageDraw.Draw(im);draw.rectangle((70,190,930,500),fill='#e9d7a7');draw.polygon([(30,190),(500,40),(970,190)],fill='#b98c45');draw.text((360,530),'University campus workflow review',fill='white');im.save('/tmp/main-workflow-campus.png')
print(json.dumps({'status':'READY','site':site.pk,'hostname':host,'run':r.run,'roles':list(r.profiles),'editorial_content_seeded':False}))
