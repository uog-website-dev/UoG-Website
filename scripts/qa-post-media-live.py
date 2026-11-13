"""Local real-service article media rehearsal. Configuration arrives on stdin."""
import io
import json
import sys
import uuid
from pathlib import Path

from PIL import Image
from django.conf import settings
from sprint3_live_review import Review, Site, SiteDomain, Module, enable_module_for_site, ContentRole

assert settings.DEBUG
config = json.load(sys.stdin)
session = Path('/tmp/post-editor-browser-session.json')
seed = json.loads(session.read_text())
r = Review.__new__(Review)
r.run = seed['run']
r.users = seed['users']
r.profiles = seed['profiles']
r.rows = []
r.seed = {'profiles': {}}
r.config = lambda key, default=None: config.get(key, default)
r.kc_admin = r.token(config['KC_ADMIN_USERNAME'], config['KC_ADMIN_PASSWORD'], client='admin-cli', realm='master')
site = Site.objects.get(pk=seed['site'])
enable_module_for_site(site.pk, Module.objects.get(code='MEDIA').pk)

try:
    for name, role, cms in [('reviewer','reviewer',ContentRole.REVIEWER),('publisher','publisher',ContentRole.PUBLISHER)]:
        r.provision(name,role,site,cms)
    image = io.BytesIO()
    Image.new('RGB',(640,360),(32,100,80)).save(image,format='PNG')
    uploaded = r.upload(site,'author',image.getvalue())
    r.wait_ready(site,'author',uploaded['id'])
    asset = uploaded['id']
    r.expect('Image metadata and alt text', r.api('PATCH',f'/api/v1/sites/{site.pk}/assets/{asset}/','author',body={'alt_text':'Campus gardens','display_name':'Campus gardens'}),200)
    host = 'article-media-' + seed['run'] + '.uog.local'
    SiteDomain.objects.create(site=site,hostname=host,is_primary=True,status='ACTIVE')
    base = f'/api/v1/sites/{site.pk}/posts/'
    body = {'title':'Published image article','slug':'public-image-'+seed['run'],'featured_media':f'sites/{site.pk}/assets/{asset}','featured_alt':'Campus gardens','editor_document':{'schema_version':1,'html':f'<p>Published university news</p><img data-asset-id="{asset}" data-node-id="{uuid.uuid4()}" alt="Campus gardens">'}}
    response = r.api('POST',base,'author',body=body)
    article = r.expect('Article asset references save',response,201)
    r.expect('Private derivative delivery',r.api('GET',f'/api/v1/sites/{site.pk}/assets/{asset}/image/','author'),200)
    r.expect('Unpublished anonymous image denied',r.api('GET',f'/api/v1/site-context/media/{asset}/',host=host),404)
    workflow=f'/api/v1/cms/sites/{site.pk}/content/{article["id"]}/workflow/'
    for actor,action in [('author','submit'),('reviewer','approve'),('publisher','publish')]:
        r.expect('Article '+action,r.api('POST',workflow,actor,body={'action':action}),200)
    r.expect('Published image delivery',r.api('GET',f'/api/v1/site-context/media/{asset}/',host=host),200)
    r.expect('Referenced image deletion blocked',r.api('DELETE',f'/api/v1/sites/{site.pk}/assets/{asset}/','author'),403)
    seed['media']={'asset':asset,'host':host,'slug':body['slug'],'published_post':article['id']}
finally:
    seed.update(users=r.users,profiles=r.profiles)
    session.write_text(json.dumps(seed))
    session.chmod(0o600)
    Path('/tmp/post-media-live.json').write_text(json.dumps({'run':r.run,'site':site.pk,'results':r.rows},indent=2))
print(json.dumps({'checks':len(r.rows),'passed':sum(row['status']=='PASS' for row in r.rows)}))
