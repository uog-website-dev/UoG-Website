"""Real-service workflow isolation and module gates, configuration on stdin."""
import json
import sys
from pathlib import Path
from django.conf import settings
from sprint3_live_review import Review, Site, SiteDomain, Module, OrganizationUnit, OrganizationType, ContentRole, enable_module_for_site, disable_module_for_site, activate_site

assert settings.DEBUG
config = json.load(sys.stdin)
session = Path('/tmp/post-editor-browser-session.json')
seed = json.loads(session.read_text())
r = Review.__new__(Review)
r.run, r.users, r.profiles, r.rows, r.seed = seed['run'], seed['users'], seed['profiles'], [], {'profiles':{}}
r.config = lambda key, default=None: config.get(key, default)
r.kc_admin = r.token(config['KC_ADMIN_USERNAME'],config['KC_ADMIN_PASSWORD'],client='admin-cli',realm='master')
a = Site.objects.get(pk=seed['site'])
module = Module.objects.get(code='POSTS')
try:
    organization = OrganizationUnit.objects.create(code='WF-B-'+r.run,name='Independent workflow QA',organization_type=OrganizationType.objects.get(code='COLLEGE'),parent=a.organization_unit.parent)
    b = Site.objects.create(code=organization.code,name='Independent workflow QA',organization_unit=organization)
    enable_module_for_site(b.pk,module.pk)
    activate_site(b.pk)
    host = 'workflow-b-'+r.run+'.uog.local'
    SiteDomain.objects.create(site=b,hostname=host,status='ACTIVE',is_primary=True)
    for name,role,cms in [('author-b','editor',ContentRole.AUTHOR),('reviewer-b','reviewer',ContentRole.REVIEWER),('publisher-b','publisher',ContentRole.PUBLISHER)]:
        r.provision(name,role,b,cms)
    article = r.expect('Independent Site article',r.api('POST',f'/api/v1/sites/{b.pk}/posts/','author-b',body={'title':'Independent article','slug':seed['media']['slug'],'editor_document':{'schema_version':1,'html':'<p>Independent Site publication</p>'}}),201)
    flow_b=f'/api/v1/cms/sites/{b.pk}/content/{article["id"]}/workflow/'
    for actor,action in [('author-b','submit'),('reviewer-b','approve'),('publisher-b','publish')]:
        r.expect('Independent Site '+action,r.api('POST',flow_b,actor,body={'action':action}),200)
    original=seed['media']['published_post']
    preview=f'/api/v1/sites/{a.pk}/posts/{original}/preview/'
    r.expect('Anonymous preview denied',r.api('GET',preview),401)
    r.expect('Authorized private saved revision preview',r.api('GET',preview,'author'),200)
    r.expect('Foreign ID preview hidden',r.api('GET',f'/api/v1/sites/{a.pk}/posts/{article["id"]}/preview/','reviewer'),404)
    r.expect('Foreign Site preview denied',r.api('GET',f'/api/v1/sites/{b.pk}/posts/{article["id"]}/preview/','reviewer'),403)
    r.expect('Foreign Site review denied',r.api('POST',flow_b,'reviewer',body={'action':'approve'}),403)
    r.expect('Foreign Site publication denied',r.api('POST',flow_b,'publisher',body={'action':'publish'}),403)
    flow_a=f'/api/v1/cms/sites/{a.pk}/content/{original}/workflow/'
    r.expect('Unsupported scheduling rejected',r.api('POST',flow_a,'publisher',body={'action':'unpublish','publish_at':'2027-01-01T00:00:00Z'}),400)
    try:
        disable_module_for_site(a.pk,module.pk)
        r.expect('Disabled POSTS preview denied',r.api('GET',preview,'author'),400)
        r.expect('Disabled POSTS workflow denied',r.api('POST',flow_a,'publisher',body={'action':'unpublish'}),400)
    finally:
        enable_module_for_site(a.pk,module.pk)
    r.expect('Original publication preserved after failures',r.api('GET',f'/api/v1/site-context/posts/{seed["media"]["slug"]}/',host=seed['media']['host']),200)
    seed['workflow']={'site_b':b.pk,'host_b':host,'post_b':article['id']}
finally:
    seed.update(users=r.users,profiles=r.profiles)
    session.write_text(json.dumps(seed));session.chmod(0o600)
    Path('/tmp/post-workflow-live.json').write_text(json.dumps({'run':r.run,'site':a.pk,'results':r.rows},indent=2))
print(json.dumps({'checks':len(r.rows),'passed':sum(row['status']=='PASS' for row in r.rows)}))
