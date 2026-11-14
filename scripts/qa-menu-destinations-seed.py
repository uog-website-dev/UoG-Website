"""Local-only named-menu browser fixtures. Credentials remain in /tmp."""
import json
import sys
sys.path.insert(0, "/tmp")
import uuid
from pathlib import Path

from sprint3_live_review import (
    Review, Site, SiteDomain, OrganizationUnit, OrganizationType, Module,
    enable_module_for_site, activate_site, get_user_model,
)
from apps.sites.services.domains import activate_domain
from apps.cms.models import Menu, MenuItem
from django.conf import settings

assert settings.DEBUG
session = Path('/tmp/menu-destinations-session.json')
assert not session.exists(), 'Clean up the previous rehearsal first.'
config = json.load(sys.stdin)
review = Review.__new__(Review)
review.rows, review.users, review.profiles = [], [], {}
review.seed = {'profiles': {}}
review.run = 'menudestinations-' + uuid.uuid4().hex[:10]
review.config = lambda key, default=None: config.get(key, default)
review.kc_admin = review.token(config['KC_ADMIN_USERNAME'], config['KC_ADMIN_PASSWORD'], client='admin-cli', realm='master')
# Wait for a healthy API before provisioning; retire only this rehearsal's identities.
import time
for attempt in range(20):
    try:
        if review.http('GET', 'http://backend:8000/health/ready')[0] == 200: break
    except Exception:
        pass
    time.sleep(1)
else:
    raise RuntimeError('Backend is not ready for the browser rehearsal')
status, _, candidates, _ = review.http('GET', 'http://keycloak:8080/admin/realms/uog/users?username=s3-menudestinations-&exact=false&max=100', token=review.kc_admin)
assert status == 200
for candidate in candidates:
    if candidate['username'].startswith('s3-menudestinations-') and candidate.get('enabled'):
        assert review.http('PUT', 'http://keycloak:8080/admin/realms/uog/users/'+candidate['id'], token=review.kc_admin, body={'enabled':False})[0] == 204
root = OrganizationUnit.objects.filter(parent__isnull=True, organization_type__code='UNIVERSITY').first()
owner = OrganizationUnit.objects.create(code=review.run.upper(), name='Menu directory QA', organization_type=OrganizationType.objects.get(code='COLLEGE'), parent=root)
# Retire identities from an interrupted rehearsal before creating a new run.
for old in get_user_model().objects.filter(username__startswith='s3-menudestinations-', is_active=True):
    status, _, matches, _ = review.http('GET', 'http://keycloak:8080/admin/realms/uog/users?username='+old.username+'&exact=true', token=review.kc_admin)
    for match in matches or []:
        assert review.http('PUT', 'http://keycloak:8080/admin/realms/uog/users/'+match['id'], token=review.kc_admin, body={'enabled': False})[0] == 204
    old.is_active = False
    old.save(update_fields=['is_active'])
sites = []
for suffix in ('a', 'b'):
    site = Site.objects.create(code=review.run.upper()+suffix.upper(), name='Layout Site '+suffix.upper(), organization_unit=owner)
    activate_site(site.pk)
    domain = SiteDomain.objects.create(site=site, hostname=review.run+suffix+'.uog.local', is_primary=True)
    activate_domain(domain.pk)
    for code in ('MENUS','PAGES','POSTS'):
        enable_module_for_site(site.pk, Module.objects.get(code=code).pk)
    sites.append(site)
from apps.cms.services.pages import create_page
from apps.api.models import Category
from apps.cms.tests.support import transition_with_site_role
from apps.authorization.models import UserRoleAssignment
menus=[]
for site in sites:
    menu=Menu.objects.create(site=site,location='header',name='Institution navigation',is_active=True)
    MenuItem.objects.create(menu=menu,site=site,label='Existing navigation',item_type='custom',target='/existing')
    menus.append(menu)
editor=review.provision('editor','editor',sites[0])
publisher=review.provision('publisher','publisher',sites[0])
review_actor=get_user_model().objects.create_user(username=review.run+'-reviewer')
page=create_page(site=sites[0],title='About the institution',slug='about-institution',actor=editor)
category=Category.objects.create(site=sites[0],code='RESEARCH',name='Research')
for content in (page,category):
    for action,actor in (('submit',editor),('approve',review_actor),('publish',publisher)):
        transition_with_site_role(content,action,actor);content.refresh_from_db()
UserRoleAssignment.objects.filter(user=review_actor).delete()
get_user_model().objects.filter(pk=review_actor.pk).update(is_active=False)
data={'run':review.run,'site':sites[0].pk,'other':sites[1].pk,'host':review.run+'a.uog.local','other_host':review.run+'b.uog.local','member':review.profiles['editor'],'publisher':review.profiles['publisher'],'member_id':editor.pk,'member_ids':[editor.pk,publisher.pk],'kc_users':review.users,'menu':str(menus[0].pk)}
session.write_text(json.dumps(data));session.chmod(0o600)
print(json.dumps({'run':review.run,'sites':[s.pk for s in sites],'result':'PASS'}))
