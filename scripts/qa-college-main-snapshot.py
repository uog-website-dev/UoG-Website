"""Read-only Main public/configuration snapshot; no response bodies or private keys exported."""
import json,hashlib,sys
from pathlib import Path
from django.apps import apps
from django.core.serializers.json import DjangoJSONEncoder
from apps.sites.models import Site
sys.path.insert(0,'/tmp')
from sprint3_live_review import Review
phase=sys.argv[-1] if sys.argv[-1] in ['before','after'] else 'before'
main=Site.objects.get(is_main=True,status='ACTIVE')
def digest(value):return hashlib.sha256(json.dumps(value,cls=DjangoJSONEncoder,sort_keys=True,separators=(',',':')).encode()).hexdigest()
models={}
# Canonical Main Site fields and Site-owned content/configuration only; identities/audit excluded.
for model in apps.get_models():
 if model._meta.app_label not in ['sites','cms','api','media']:continue
 fields={f.name:f for f in model._meta.fields}
 if model is Site:rows=list(model.objects.filter(pk=main.pk).values())
 elif 'site' in fields:rows=list(model.objects.filter(site=main).order_by('pk').values())
 elif model._meta.label_lower=='cms.menuitem':rows=list(model.objects.filter(menu__site=main).order_by('pk').values())
 elif 'content' in fields and fields['content'].is_relation and fields['content'].related_model._meta.label_lower=='cms.sitecontent':rows=list(model.objects.filter(content__site=main).order_by('pk').values())
 else:continue
 models[model._meta.label_lower]={'count':len(rows),'sha256':digest(rows)}
r=Review.__new__(Review)
host=main.domains.get(is_primary=True,status='ACTIVE').hostname
public={}
for route in ['/api/v1/site-context/','/api/v1/site-context/homepage/','/api/v1/site-context/posts/','/api/v1/site-context/menus/?location=header','/api/v1/site-context/menus/?location=footer']:
 status,_,body,_=r.http('GET','http://nginx'+route,headers={'Host':host})
 public[route]={'status':status,'sha256':digest(body)}
result={'main_site':main.pk,'hostname':host,'models':models,'public':public}
p=Path('/tmp/college-main-before.json')
if phase=='before':p.write_text(json.dumps(result));print(json.dumps(result,indent=2))
else:
 before=json.loads(p.read_text());changed=[k for k in models if before['models'].get(k)!=models[k]];public_changed=[k for k in public if before['public'].get(k)!=public[k]]
 result.update({'changed_models':changed,'changed_public_routes':public_changed,'unchanged':not changed and not public_changed});print(json.dumps(result,indent=2));assert result['unchanged'],'Main state changed'
