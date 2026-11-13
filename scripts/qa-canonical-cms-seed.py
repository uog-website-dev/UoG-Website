"""Real identity fixture for canonical membership/revocation browser evidence."""
import json,sys,uuid,time
from pathlib import Path
from sprint3_live_review import Review,Site,OrganizationUnit,OrganizationType,Module,enable_module_for_site,activate_site,get_user_model
from apps.api.models import Post
from apps.authorization.models import Role,UserRoleAssignment
from apps.cms.services.workflow import transition_content
from django.conf import settings
assert settings.DEBUG
p=Path('/tmp/canonical-cms-session.json');assert not p.exists()
config=json.load(sys.stdin)
r=Review.__new__(Review);r.rows=[];r.users=[];r.profiles={};r.seed={'profiles':{}}
r.run='canonical-'+uuid.uuid4().hex[:10];r.config=lambda key,default=None:config.get(key,default)
r.kc_admin=r.token(config['KC_ADMIN_USERNAME'],config['KC_ADMIN_PASSWORD'],client='admin-cli',realm='master')
root=OrganizationUnit.objects.filter(parent__isnull=True,organization_type__code='UNIVERSITY').first()
owner=OrganizationUnit.objects.create(code=r.run.upper(),name='Canonical CMS QA',organization_type=OrganizationType.objects.get(code='COLLEGE'),parent=root)
a=Site.objects.create(code=r.run.upper()+'A',name='Canonical Site A',organization_unit=owner)
b=Site.objects.create(code=r.run.upper()+'B',name='Canonical Site B',organization_unit=owner)
for site in [a,b]:
    activate_site(site.pk)
    for code in ['POSTS','PAGES']:
        enable_module_for_site(site.pk,Module.objects.get(code=code).pk)
member=r.provision('member','editor',a)
root_token=r.token(config.get('KEYCLOAK_DEV_USERNAME','devuser'),config['KEYCLOAK_DEV_PASSWORD'])
seed_author=get_user_model().objects.create_user(username=r.run+'-seed-author')
seed_reviewer=get_user_model().objects.create_user(username=r.run+'-seed-reviewer')
for user,code in [(seed_author,'editor'),(seed_reviewer,'reviewer')]:
    UserRoleAssignment.objects.create(user=user,site=a,organization=owner,scope='SITE',role=Role.objects.get(code=code))
for state in ['draft','review','approved']:
    post=Post.objects.create(site=a,title='Canonical '+state,slug='canonical-'+state,content='<p>Private membership regression.</p>',created_by=seed_author,updated_by=seed_author)
    if state!='draft':transition_content(post.pk,action='submit',actor=seed_author)
    if state=='approved':transition_content(post.pk,action='approve',actor=seed_reviewer,comment='Approved fixture revision')
UserRoleAssignment.objects.filter(user__in=[seed_author,seed_reviewer]).delete()
get_user_model().objects.filter(pk__in=[seed_author.pk,seed_reviewer.pk]).update(is_active=False)
seed={'run':r.run,'site':a.pk,'other':b.pk,'organization':owner.pk,'member':r.profiles['member'],'member_id':member.pk,'root_token':root_token,'kc_users':r.users,'roles':dict(Role.objects.filter(code__in=['editor','reviewer','publisher']).values_list('code','pk')),'assignment':UserRoleAssignment.objects.get(user=member,site=a).pk}
p.write_text(json.dumps(seed));p.chmod(0o600)
print(json.dumps({'run':r.run,'site':a.pk,'other':b.pk,'identity_created':True,'legacy_table_used':False}))
