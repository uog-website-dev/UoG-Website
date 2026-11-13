"""Real public listing fixtures and negative checks. Configuration on stdin."""
import json
import sys
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch
from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone
from sprint3_live_review import Review, Site, SiteDomain, Module, ContentRole, enable_module_for_site, disable_module_for_site, activate_site
from apps.api.models import Post
from apps.authorization.models import Role,UserRoleAssignment
from apps.cms.services.workflow import transition_content

assert settings.DEBUG
config = json.load(sys.stdin)
session = Path('/tmp/post-editor-browser-session.json')
seed = json.loads(session.read_text())
r = Review.__new__(Review)
r.run,r.users,r.profiles,r.rows,r.seed = seed['run'],seed['users'],seed['profiles'],[],{'profiles':{}}
r.config = lambda key,default=None: config.get(key,default)
r.kc_admin = r.token(config['KC_ADMIN_USERNAME'],config['KC_ADMIN_PASSWORD'],client='admin-cli',realm='master')
a = Site.objects.get(pk=seed['site'])
module = Module.objects.get(code='POSTS')
actors = {role:get_user_model().objects.get(username=seed['profiles'][role]['username']) for role in ['author','reviewer','publisher']}

def publish(post, people):
    for role,action in [('author','submit'),('reviewer','approve'),('publisher','publish')]:
        transition_content(post.pk,action=action,actor=people[role])
    post.refresh_from_db()
    return post

def site(label,owner,enabled=True):
    result = Site.objects.create(code='NEWS-'+label+'-'+r.run,name=label.title()+' news QA',organization_unit=owner)
    enable_module_for_site(result.pk,module.pk)
    activate_site(result.pk)
    host = 'news-'+label+'-'+r.run+'.uog.local'
    SiteDomain.objects.create(site=result,hostname=host,status='ACTIVE',is_primary=True)
    return result,host

try:
    stamp = timezone.now()-timedelta(days=1)
    with patch('django.utils.timezone.now',lambda:stamp):
        for number in range(22):
            article = Post.objects.filter(site=a,slug=f'campus-update-{number+1:02d}').first()
            if article is None:
                article = Post.objects.create(site=a,title=f'Campus update {number+1:02d}',slug=f'campus-update-{number+1:02d}',excerpt='Research, teaching and community updates from the university.',content='Published news fixture',created_by=actors['author'],updated_by=actors['author'])
            if article.status != "PUBLISHED":
                publish(article,actors)
    b,host_b = site('central',a.organization_unit.parent)
    for name,role,cms in [('author-b','editor',ContentRole.AUTHOR),('reviewer-b','reviewer',ContentRole.REVIEWER),('publisher-b','publisher',ContentRole.PUBLISHER)]:
        r.provision(name,role,b,cms)
    people_b = {role:get_user_model().objects.get(username=r.profiles[role+'-b']['username']) for role in ['author','reviewer','publisher']}
    foreign = publish(Post.objects.create(site=b,title='Central Site update',slug=seed['media']['slug'],excerpt='An independent Site publication.',content='Central Site body',created_by=people_b['author'],updated_by=people_b['author']),people_b)
    empty,host_empty = site('empty',a.organization_unit)
    disabled,host_disabled = site('disabled',a.organization_unit)
    for role,person in people_b.items():
        UserRoleAssignment.objects.create(site=disabled,organization=disabled.organization_unit,scope='SITE',user=person,role=Role.objects.get(code={'author':'editor','reviewer':'reviewer','publisher':'publisher'}[role]))
    publish(Post.objects.create(site=disabled,title='Disabled private marker',slug='disabled-marker',content='DISABLED CONTENT MARKER',created_by=people_b['author'],updated_by=people_b['author']),people_b)
    UserRoleAssignment.objects.filter(site=disabled).update(revoked_at=timezone.now())
    disable_module_for_site(disabled.pk,module.pk)
    Post.objects.create(site=a,title='Draft private marker',slug='draft-private-marker',content='DRAFT CONTENT MARKER')
    with patch('django.utils.timezone.now',lambda:timezone.datetime(2035,1,1,tzinfo=timezone.get_current_timezone())):
        future = publish(Post.objects.create(site=a,title='Future marker',slug='future-marker',content='FUTURE CONTENT MARKER',created_by=actors['author'],updated_by=actors['author']),actors)
    root='/api/v1/site-context/posts/'
    first=r.expect('Default public page',r.api('GET',root,host=seed['media']['host']),200)
    r.check('Default twenty and scoped count',first['count']==23 and len(first['results'])==20 and all(row['site']==a.pk for row in first['results']))
    second=r.expect('Second public page',r.api('GET',root+'?page=2',host=seed['media']['host']),200)
    r.check('Stable page boundary',len(second['results'])==3 and not {row['id'] for row in first['results']} & {row['id'] for row in second['results']})
    r.check('Summary has no draft body or internal fields',all(not set(row)&{'content','editor_document','metadata','review_comment','storage_reference','created_by'} for row in first['results']))
    r.expect('Maximum page size',r.api('GET',root+'?page_size=100',host=seed['media']['host']),200)
    for query in ['page_size=101','page_size=0','page_size=bad','page=-1','site_id='+str(b.pk)]:
        r.expect('Invalid query '+query,r.api('GET',root+'?'+query,host=seed['media']['host']),400)
    r.expect('Future detail hidden',r.api('GET',root+future.slug+'/',host=seed['media']['host']),404)
    r.expect('Empty Site list',r.api('GET',root,host=host_empty),200)
    r.expect('Disabled Site list',r.api('GET',root,host=host_disabled),404)
    other=r.expect('Independent university-owned Site list',r.api('GET',root,host=host_b),200)
    r.check('Independent catalog',other['count']==1 and other['results'][0]['id']==str(foreign.pk))
    seed['news']={'host_a':seed['media']['host'],'host_b':host_b,'host_empty':host_empty,'host_disabled':host_disabled,'site_b':b.pk,'expected_count':23,'first_ids':[row['id'] for row in first['results']],'second_ids':[row['id'] for row in second['results']]}
finally:
    seed.update(users=r.users,profiles=r.profiles)
    session.write_text(json.dumps(seed));session.chmod(0o600)
    Path('/tmp/public-news-live.json').write_text(json.dumps({'run':r.run,'site_a':a.pk,'results':r.rows},indent=2))
print(json.dumps({'checks':len(r.rows),'passed':sum(row['status']=='PASS' for row in r.rows)}))
