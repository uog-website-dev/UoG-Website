"""Real HTTP negative gates and unchanged Post publication workflow rehearsal."""
import json, sys, uuid
from pathlib import Path
from sprint3_live_review import (Review, Site, SiteDomain, Module, OrganizationUnit, OrganizationType,
    ContentRole, enable_module_for_site, disable_module_for_site, activate_site)
from apps.api.models import Post
from apps.cms.models import ContentRevision
from django.conf import settings
assert settings.DEBUG
config=json.load(sys.stdin)
p=Path('/tmp/post-editor-browser-session.json');seed=json.loads(p.read_text())
r=Review.__new__(Review);r.run=seed['run'];r.users=seed['users'];r.profiles=seed['profiles'];r.rows=[];r.seed={'profiles':{}}
r.config=lambda key,default=None:config.get(key,default)
r.kc_admin=r.token(config['KC_ADMIN_USERNAME'],config['KC_ADMIN_PASSWORD'],client='admin-cli',realm='master')
a=Site.objects.get(pk=seed['site']);module=Module.objects.get(code='POSTS')
def persist():
    seed.update(users=r.users,profiles=r.profiles);p.write_text(json.dumps(seed));p.chmod(0o600)
try:
    for name,role,cms in [('reader','viewer',None),('reviewer','reviewer',ContentRole.REVIEWER),('publisher','publisher',ContentRole.PUBLISHER)]:
        try:r.provision(name,role,a,cms)
        finally:persist()
    org=OrganizationUnit.objects.create(code='P4B-'+uuid.uuid4().hex[:12],name='Foreign article QA',organization_type=OrganizationType.objects.get(code='COLLEGE'),parent=a.organization_unit.parent)
    b=Site.objects.create(code=org.code,name='Foreign article QA',organization_unit=org);enable_module_for_site(b.pk,module.pk);activate_site(b.pk)
    foreign=Post.objects.create(site=b,title='Foreign private report',slug='foreign-private-report',content='FOREIGN PRIVATE MARKER')
    base=f'/api/v1/sites/{a.pk}/posts/'
    document={'schema_version':1,'html':'<h2>Published campus news</h2><p>A <strong>formatted</strong> public report with <em>emphasis</em>.</p><ul><li>Campus</li></ul><blockquote>University research</blockquote>'}
    data={'title':'Public formatted article QA','slug':'public-'+r.run,'editor_document':document}
    r.expect('Unauthenticated direct write denied',r.api('POST',base,body=data),401)
    r.expect('Authenticated viewer direct write denied',r.api('POST',base,'reader',body=data),403)
    r.expect('Foreign ID read under authorized Site denied',r.api('GET',base+f'{foreign.pk}/','author'),404)
    r.expect('Foreign ID mutation under authorized Site denied',r.api('PATCH',base+f'{foreign.pk}/','author',body={'title':'Tampered'},headers={'If-Match':'"foreign"'}),404)
    r.expect('Foreign Site route denied',r.api('GET',f'/api/v1/sites/{b.pk}/posts/{foreign.pk}/','author'),403)
    count=Post.objects.count();history=ContentRevision.objects.count()
    invalid=r.api('POST',base,'author',body={'slug':'invalid-'+r.run,'editor_document':{'schema_version':9,'html':'Invalid'}})
    error=r.expect('Invalid title and editor version rejected',invalid,400)
    r.check('Field errors and atomic rejection','title' in error['error']['details'] and 'editor_document' in error['error']['details'] and Post.objects.count()==count and ContentRevision.objects.count()==history)
    try:
        disable_module_for_site(a.pk,module.pk)
        r.expect('Disabled POSTS write denied',r.api('POST',base,'author',body=data),400)
    finally:enable_module_for_site(a.pk,module.pk)
    foreign.refresh_from_db();r.check('Foreign metadata unchanged',foreign.content=='FOREIGN PRIVATE MARKER' and foreign.title=='Foreign private report')
    created=r.api('POST',base,'author',body=data);article=r.expect('Re-enabled POSTS formatted draft create',created,201)
    workflow=f'/api/v1/cms/sites/{a.pk}/content/{article["id"]}/workflow/'
    for action,actor in [('submit','author'),('approve','reviewer'),('publish','publisher')]:
        r.expect('Existing workflow '+action,r.api('POST',workflow,actor,body={'action':action}),200)
    host='p4-'+r.run+'.uog.local'
    SiteDomain.objects.create(site=a,hostname=host,is_primary=True,status='ACTIVE')
    public=r.expect('Anonymous formatted Post on existing public API',r.api('GET','/api/v1/site-context/posts/'+data['slug']+'/',host=host),200)
    r.check('Published representation preserved',public['editor_document']==document)
    seed['published']={'host':host,'slug':data['slug'],'title':data['title']};seed['foreign_site']=b.pk
finally:
    persist()
    target=Path('/tmp/post-editor-live-api.json');target.write_text(json.dumps({'run':r.run,'site_a':a.pk,'results':r.rows},indent=2))
print(json.dumps({'checks':len(r.rows),'passed':sum(x['status']=='PASS' for x in r.rows)}))
