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
get_user_model().objects.filter(username__startswith='menurender-',is_active=True).update(is_active=False)
session = Path('/tmp/menu-rendering-session.json')
assert not session.exists(), 'Clean up the previous rehearsal first.'
config = json.load(sys.stdin)
review = Review.__new__(Review)
review.rows, review.users, review.profiles = [], [], {}
review.seed = {'profiles': {}}
review.run = 'menurender-' + uuid.uuid4().hex[:10]
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
status, _, candidates, _ = review.http('GET', 'http://keycloak:8080/admin/realms/uog/users?username=s3-menurender-&exact=false&max=100', token=review.kc_admin)
assert status == 200
for candidate in candidates:
    if candidate['username'].startswith('s3-menurender-') and candidate.get('enabled'):
        assert review.http('PUT', 'http://keycloak:8080/admin/realms/uog/users/'+candidate['id'], token=review.kc_admin, body={'enabled':False})[0] == 204
root = OrganizationUnit.objects.filter(parent__isnull=True, organization_type__code='UNIVERSITY').first()
owner = OrganizationUnit.objects.create(code=review.run.upper(), name='Menu directory QA', organization_type=OrganizationType.objects.get(code='COLLEGE'), parent=root)
# Retire identities from an interrupted rehearsal before creating a new run.
for old in get_user_model().objects.filter(username__startswith='s3-menurender-', is_active=True):
    status, _, matches, _ = review.http('GET', 'http://keycloak:8080/admin/realms/uog/users?username='+old.username+'&exact=true', token=review.kc_admin)
    for match in matches or []:
        assert review.http('PUT', 'http://keycloak:8080/admin/realms/uog/users/'+match['id'], token=review.kc_admin, body={'enabled': False})[0] == 204
    old.is_active = False
    old.save(update_fields=['is_active'])
sites = []
for suffix in ('a', 'b'):
    site = Site.objects.create(code=review.run.upper()+suffix.upper(), name='Menu slot Site '+suffix.upper(), organization_unit=owner)
    activate_site(site.pk)
    domain = SiteDomain.objects.create(site=site, hostname=review.run+suffix+'.uog.local', is_primary=True)
    activate_domain(domain.pk)
    for code in ('MENUS','PAGES'):
        enable_module_for_site(site.pk, Module.objects.get(code=code).pk)
    sites.append(site)
# Authorize the alternate local callback; port 80/8080 belong to WordPress.
origin=config.get('QA_ORIGIN','http://localhost').rstrip('/')
assert origin in ('http://localhost','http://localhost:8088')
status,_,clients,_=review.http('GET','http://keycloak:8080/admin/realms/uog/clients?clientId=admin-web',token=review.kc_admin)
assert status==200 and len(clients)==1
client=clients[0];redirect=origin+'/admin/api/auth/callback/keycloak'
client['redirectUris']=list(dict.fromkeys([*client.get('redirectUris',[]),redirect]))
client['webOrigins']=list(dict.fromkeys([*client.get('webOrigins',[]),origin]))
assert review.http('PUT','http://keycloak:8080/admin/realms/uog/clients/'+client['id'],token=review.kc_admin,body=client)[0]==204
admin=review.provision('admin','site-administrator',sites[0])
from apps.cms.services.menus import set_menu_active,menu_etag
menus={}
for name,location in (('Original header','header'),('Primary replacement',''),('Footer links',''),('Utility links',''),('Sidebar links','')):
    menu=Menu.objects.create(site=sites[0],name=name,location=location,is_active=False)
    MenuItem.objects.create(menu=menu,site=sites[0],label=name+' link',item_type='custom',target='/review-page')
    menu.refresh_from_db();set_menu_active(menu.pk,actor=admin,expected=menu_etag(menu),active=True);menus[name]=str(menu.pk)
other=Menu.objects.create(site=sites[1],name='Independent header',location='header')
MenuItem.objects.create(menu=other,site=sites[1],label='Independent link',item_type='custom',target='/independent')
from apps.cms.services.pages import create_page
from apps.cms.tests.support import transition_with_site_role
from apps.authorization.models import UserRoleAssignment
actors=[get_user_model().objects.create_user(username=review.run+'-'+role) for role in ('reviewer','publisher')]
page=create_page(site=sites[0],title='Template location review',slug='review-page',layout='LEFT_SIDEBAR',blocks=[{'type':'paragraph','html':'<p>Published institutional information.</p>'}],actor=admin)
for action,actor in zip(('submit','approve','publish'),[admin,*actors]):
    transition_with_site_role(page,action,actor);page.refresh_from_db()
UserRoleAssignment.objects.filter(user__in=actors).delete();get_user_model().objects.filter(pk__in=[a.pk for a in actors]).update(is_active=False)
data={'main_host':'www.uog.local','origin':origin,'run':review.run,'site':sites[0].pk,'other':sites[1].pk,'host':review.run+'a.uog.local','other_host':review.run+'b.uog.local','member':review.profiles['admin'],'member_id':admin.pk,'kc_users':review.users,'menus':menus}
from apps.cms.services.menu_locations import write_location
primary=Menu.objects.get(pk=menus['Primary replacement'])
item=primary.items.get(parent=None);item.label='Draft primary label';item.save()
MenuItem.objects.create(site=sites[0],menu=primary,parent=item,label='Nested draft link',item_type='custom',target='/review-page')
for location,name in [('header','Primary replacement'),('secondary','Utility links'),('footer','Footer links'),('sidebar','Sidebar links')]:
    write_location(sites[0].pk,location,actor=admin,expected=0,menu_id=menus[name],replace=True)
publisher=review.provision('publisher','publisher',sites[0])
from apps.authorization.models import Role
UserRoleAssignment.objects.filter(user=admin,site=sites[0],role__code='site-administrator').delete()
UserRoleAssignment.objects.get_or_create(user=admin,role=Role.objects.get(code='editor'),scope='SITE',site=sites[0],organization=sites[0].organization_unit)
data['publisher']=review.profiles['publisher'];data['publisher_id']=publisher.pk;data['member_ids']=[admin.pk,publisher.pk];data['kc_users']=review.users
session.write_text(json.dumps(data));session.chmod(0o600)
print(json.dumps({'run':review.run,'sites':[s.pk for s in sites],'origin':origin,'result':'PASS'}))
