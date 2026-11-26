"""Template locations: private assignments, atomic promotion, isolation and fallback."""
import pytest
from django.db import IntegrityError,transaction
from apps.cms.models import MenuLocationAssignment,Menu
from .test_menu_api import api,ready,_menu,_item,_post,_tag
from .test_public_posts import _host
pytestmark=pytest.mark.django_db

def create(api,name,location=''):
    r=api.client.post(api.base,{'name':name,'location':location},content_type='application/json',**api.header);assert r.status_code==201,r.content
    _item(api,r['Location'],name,target='/'+name.lower())
    assert _post(api,r['Location']+'activate/',{},_tag(api,r['Location'])).status_code==200
    return r.json()['id']

def call(api,slot,body,action='draft',site=None,header=None):
    return api.client.post(f'/api/v1/sites/{site or api.site.pk}/menus/locations/{slot}/{action}/',body,content_type='application/json',**(header or api.header))

def public(api,host,slot='header'):
    r=api.client.get('/api/v1/site-context/menus/?location='+slot,HTTP_HOST=host);assert r.status_code==200,r.content
    return r.json()['locations'][slot]

def test_explicit_replace_draft_publish_and_unassign_preserve_menus(api):
    first=create(api,'First','header');second=create(api,'Second');footer=create(api,'Footer');host=_host(api.site)
    assert public(api,host)[0]['label']=='First'
    slots=api.client.get(api.base+'locations/',**api.header).json()
    assert [r['label'] for r in slots]==['Primary Header','Utility Header','Footer','Page Sidebar']
    assert call(api,'header',{'version':0,'menu':second}).status_code==409
    saved=call(api,'header',{'version':0,'menu':second,'replace':True});assert saved.status_code==200,saved.content
    assert public(api,host)[0]['label']=='First'
    assert call(api,'header',{'version':saved.json()['version']},'publish').status_code==200
    assert public(api,host)[0]['label']=='Second'
    row=call(api,'footer',{'version':0,'menu':footer});assert row.status_code==200
    assert call(api,'footer',{'version':row.json()['version']},'publish').status_code==200
    assert public(api,host,'footer')[0]['label']=='Footer' and public(api,host)[0]['label']=='Second'
    sidebar=create(api,'Sidebar')
    row=call(api,'sidebar',{'version':0,'menu':sidebar});assert row.status_code==200
    assert call(api,'sidebar',{'version':row.json()['version']},'publish').status_code==200
    assert public(api,host,'sidebar')[0]['label']=='Sidebar' and public(api,host)[0]['label']=='Second'
    saved=call(api,'header',{'version':2,'menu':None});assert saved.status_code==200,saved.content
    assert public(api,host)[0]['label']=='Second'
    assert call(api,'header',{'version':saved.json()['version']},'publish').status_code==200
    assert public(api,host)==[] and Menu.objects.filter(pk__in=[first,second,footer]).count()==3

def test_unpublished_menu_and_stale_versions_do_not_replace_public(api):
    first=create(api,'First','header');host=_host(api.site)
    draft=api.client.post(api.base,{'name':'Private menu'},content_type='application/json',**api.header).json()['id']
    saved=call(api,'header',{'version':0,'menu':draft,'replace':True});assert saved.status_code==200
    assert call(api,'header',{'version':saved.json()['version']},'publish').status_code==400
    assert public(api,host)[0]['label']=='First'
    assert call(api,'header',{'version':0,'menu':None}).status_code==409
    assert MenuLocationAssignment.objects.get(site=api.site,location='header').draft_menu_id.__str__()==draft

def test_scope_supported_slots_and_database_guards(api):
    foreign=Menu.objects.create(site=api.other,name='Foreign',location='')
    for slot,menu in [('unsupported',None),('primary',None),('header',str(foreign.pk))]:
        assert call(api,slot,{'version':0,'menu':menu}).status_code==400
    assert not MenuLocationAssignment.objects.exists()
    assert call(api,'header',{'version':0,'menu':None},site=api.other.pk).status_code==403
    with pytest.raises(IntegrityError),transaction.atomic():
        MenuLocationAssignment.objects.bulk_create([MenuLocationAssignment(site=api.site,location='header',draft_menu=foreign)])
    assert not MenuLocationAssignment.objects.exists()


def test_primary_menu_location_is_retired(api):
    """Finding 8: primary is not assignable and cannot be stored on Menu rows."""
    from django.core.exceptions import ValidationError
    with pytest.raises(ValidationError, match='Primary is retired'):
        Menu(site=api.site,name='Legacy primary',location='primary').full_clean()
    created=api.client.post(api.base,{'name':'No primary','location':'primary'},content_type='application/json',**api.header)
    assert created.status_code==400,created.content

def test_restricted_template_and_legacy_fallback(api):
    from apps.sites.models import SiteTemplate
    template=SiteTemplate.objects.create(code='HEADER_ONLY',name='Header only',description='Restricted renderer',status='ACTIVE',menu_locations=['header'])
    api.site.template=template;api.site.save(update_fields=['template'])
    first=create(api,'Legacy','header');host=_host(api.site)
    assert len(api.client.get(api.base+'locations/',**api.header).json())==1
    assert call(api,'footer',{'version':0,'menu':first}).status_code==400
    assert public(api,host)[0]['label']=='Legacy'
    with pytest.raises(IntegrityError),transaction.atomic():
        MenuLocationAssignment.objects.bulk_create([MenuLocationAssignment(site=api.site,location='footer')])
    from django.core.exceptions import ValidationError
    with pytest.raises(ValidationError):
        template.menu_locations=['header','header'];template.save()

def test_role_module_gate_and_audit(api):
    from apps.authorization.models import UserRoleAssignment,Role
    from apps.sites.models import Module
    from apps.sites.services.modules import disable_module_for_site
    from apps.audit.models import AuditEvent
    menu=create(api,'Assigned');saved=call(api,'header',{'version':0,'menu':menu});assert saved.status_code==200
    assert AuditEvent.objects.filter(action='MENU_LOCATION_DRAFT_SAVED',actor_id=str(api.user.pk),after__site_id=api.site.pk).exists()
    UserRoleAssignment.objects.filter(user=api.user).update(role=Role.objects.get(code='editor'))
    assert call(api,'header',{'version':1},'publish').status_code==403
    UserRoleAssignment.objects.filter(user=api.user).update(role=Role.objects.get(code='viewer'))
    assert call(api,'header',{'version':1,'menu':None}).status_code==403
    UserRoleAssignment.objects.filter(user=api.user).update(role=Role.objects.get(code='site-administrator'))
    disable_module_for_site(api.site.pk,Module.objects.get(code='MENUS').pk)
    assert call(api,'header',{'version':1},'publish').status_code==400
    assert call(api,'header',{'version':1,'menu':None}).status_code==400

@pytest.mark.django_db(transaction=True)
def test_concurrent_slot_creation_has_one_winner(api):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from django.db import close_old_connections
    from apps.cms.services.menu_locations import write_location
    from apps.cms.services.menus import MenuConflict
    a=create(api,'Choicea');b=create(api,'Choiceb');barrier=Barrier(2)
    def update(menu):
        close_old_connections()
        try:
            barrier.wait(timeout=15)
            write_location(api.site.pk,'header',actor=api.user,expected=0,menu_id=menu)
            return 'saved'
        except MenuConflict:return 'conflict'
        finally:close_old_connections()
    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(update,[a,b]))==['conflict','saved']
    assert MenuLocationAssignment.objects.filter(site=api.site,location='header').count()==1


@pytest.mark.parametrize('operation',['read','draft','publish'])
def test_foreign_administrator_cannot_read_or_change_existing_assignments(api,operation):
    from django.contrib.auth import get_user_model
    foreign=Menu.objects.create(site=api.other,name='Foreign private menu',location='',is_active=False)
    owner=get_user_model().objects.create_user(username='foreign-menu-owner')
    row=MenuLocationAssignment.objects.create(site=api.other,location='header',draft_menu=foreign,updated_by=owner)
    before=list(MenuLocationAssignment.objects.filter(pk=row.pk).values())
    if operation=='read':
        response=api.client.get(f'/api/v1/sites/{api.other.pk}/menus/locations/',**api.header)
    else:
        body={'version':row.version,**({'menu':None} if operation=='draft' else {})}
        response=call(api,'header',body,operation,site=api.other.pk)
    assert response.status_code==403,response.content
    assert list(MenuLocationAssignment.objects.filter(pk=row.pk).values())==before
    assert b'Foreign private menu' not in response.content


def test_anonymous_assignment_request_is_denied_without_creating_a_row(api):
    response=api.client.post(api.base+'locations/header/draft/',{'version':0,'menu':None},content_type='application/json')
    assert response.status_code==401
    assert not MenuLocationAssignment.objects.exists()


def test_module_disable_and_reenable_revalidate_published_assignment(api):
    from apps.sites.models import Module
    from apps.sites.services.modules import disable_module_for_site,enable_module_for_site
    menu=create(api,'Publishednav');host=_host(api.site)
    saved=call(api,'header',{'version':0,'menu':menu});assert saved.status_code==200
    assert call(api,'header',{'version':saved.json()['version']},'publish').status_code==200
    before=public(api,host)
    row_before=list(MenuLocationAssignment.objects.filter(site=api.site).values())
    module=Module.objects.get(code='MENUS')
    disable_module_for_site(api.site.pk,module.pk)
    response=api.client.get('/api/v1/site-context/menus/?location=header',HTTP_HOST=host)
    assert response.status_code==404 and b'Publishednav' not in response.content
    assert call(api,'header',{'version':2,'menu':None}).status_code==400
    assert call(api,'header',{'version':2},'publish').status_code==400
    assert list(MenuLocationAssignment.objects.filter(site=api.site).values())==row_before
    enable_module_for_site(api.site.pk,module.pk)
    assert public(api,host)==before


def test_main_site_uses_the_same_scoped_assignment_and_public_delivery(api):
    from types import SimpleNamespace
    from apps.sites.models import Site,Module
    from apps.sites.services.modules import enable_module_for_site
    from apps.authorization.models import UserRoleAssignment,Role
    root=api.site.organization_unit
    while root.parent_id:root=root.parent
    main=Site.objects.create(organization_unit=root,code='MAIN_MENU_LOCATION',name='University Main Site',is_main=True)
    enable_module_for_site(main.pk,Module.objects.get(code='MENUS').pk)
    UserRoleAssignment.objects.create(user=api.user,role=Role.objects.get(code='site-administrator'),scope='SITE',site=main,organization=root)
    context=SimpleNamespace(**{**vars(api),'site':main,'base':f'/api/v1/sites/{main.pk}/menus/'})
    menu=create(context,'Mainnav');host=_host(main)
    saved=call(context,'header',{'version':0,'menu':menu});assert saved.status_code==200,saved.content
    assert call(context,'header',{'version':saved.json()['version']},'publish').status_code==200
    assert public(context,host)[0]['label']=='Mainnav'
    assert not MenuLocationAssignment.objects.filter(site=api.site).exists()


def test_footer_columns_are_ordered_private_scoped_and_revalidated(api):
    first=create(api,'Resources');second=create(api,'University');host=_host(api.site)
    saved=call(api,'footer',{'version':0,'menus':[first,second]})
    assert saved.status_code==200,saved.content
    assert saved.json()['draft_menus']==[first,second]
    assert public(api,host,'footer')==[]
    preview=api.client.get(api.base+'preview-navigation/',**api.header)
    assert [n['label'] for n in preview.json()['locations']['footer']]==['Resources','University']
    result=call(api,'footer',{'version':saved.json()['version']},'publish')
    assert result.status_code==200,result.content
    columns=public(api,host,'footer')
    assert [n['label'] for n in columns]==['Resources','University']
    assert columns[1]['children'][0]['label']=='University'
    assert all(n['column'] for n in columns)
    assert call(api,'footer',{'version':0,'menus':[]}).status_code==409
    version=result.json()['version']
    for ids in [[first,first],[first]*5,[str(Menu.objects.create(site=api.other,name='Foreign column',location='').pk)]]:
        assert call(api,'footer',{'version':version,'menus':ids}).status_code==400
    assert call(api,'header',{'version':0,'menus':[first,second]}).status_code==400
    draft=call(api,'footer',{'version':version,'menus':[second,first],'replace':True})
    assert draft.status_code==200,draft.content
    assert [n['label'] for n in public(api,host,'footer')]==['Resources','University']
    assert call(api,'footer',{'version':draft.json()['version']},'publish').status_code==200
    assert [n['label'] for n in public(api,host,'footer')]==['University','Resources']
    row=MenuLocationAssignment.objects.get(site=api.site,location='footer')
    clear=call(api,'footer',{'version':row.version,'menus':[]})
    assert call(api,'footer',{'version':clear.json()['version']},'publish').status_code==200
    assert public(api,host,'footer')==[]
    assert Menu.objects.filter(pk__in=[first,second]).count()==2


def test_footer_columns_db_guard_and_inactive_publish(api):
    first=create(api,'Primary');second=Menu.objects.create(site=api.site,name='Draft column',location='',is_active=False)
    foreign=Menu.objects.create(site=api.other,name='Foreign',location='')
    for values in [[first,str(foreign.pk)],[first,first]]:
        with pytest.raises(IntegrityError),transaction.atomic():
            MenuLocationAssignment.objects.bulk_create([MenuLocationAssignment(site=api.site,location='footer',draft_menu_id=first,draft_menus=values)])
    saved=call(api,'footer',{'version':0,'menus':[first,str(second.pk)]})
    assert saved.status_code==200,saved.content
    assert call(api,'footer',{'version':saved.json()['version']},'publish').status_code==400
    with pytest.raises(IntegrityError),transaction.atomic():
        Menu.objects.filter(pk=second.pk).delete()
    assert not MenuLocationAssignment.objects.get(site=api.site,location='footer').is_published


def test_deleting_assigned_menu_returns_409_menu_assigned(api):
    """Finding 6: ProtectedError and footer-column guards surface as 409 menu_assigned."""
    header=create(api,'HeaderSlot')
    assigned=call(api,'header',{'version':0,'menu':header,'replace':True})
    assert assigned.status_code==200,assigned.content
    assert call(api,'header',{'version':assigned.json()['version']},'publish').status_code==200
    footer_a=create(api,'FootA');footer_b=create(api,'FootB')
    saved=call(api,'footer',{'version':0,'menus':[footer_a,footer_b]})
    assert saved.status_code==200,saved.content
    assert call(api,'footer',{'version':saved.json()['version']},'publish').status_code==200

    # Empty the trees so children_present does not mask assignment protection.
    for menu_id in (header, footer_a, footer_b):
        url=api.base+str(menu_id)+'/'
        for item in api.client.get(url+'tree/',**api.header).json()['items']:
            assert api.client.delete(url+'items/'+item['id']+'/',HTTP_IF_MATCH=_tag(api,url),**api.header).status_code==204

    blocked=api.client.delete(api.base+str(header)+'/',HTTP_IF_MATCH=_tag(api,api.base+str(header)+'/'),**api.header)
    assert blocked.status_code==409,blocked.content
    assert blocked.json()['error']['details']['reason']=='menu_assigned'

    blocked=api.client.delete(api.base+str(footer_b)+'/',HTTP_IF_MATCH=_tag(api,api.base+str(footer_b)+'/'),**api.header)
    assert blocked.status_code==409,blocked.content
    assert blocked.json()['error']['details']['reason']=='menu_assigned'
    assert Menu.objects.filter(pk__in=[header,footer_a,footer_b]).count()==3


def test_extra_footer_menu_mutation_invalidates_the_assigned_slot(api):
    first=create(api,'Firstcolumn');second=create(api,'Extracolumn');host=_host(api.site)
    saved=call(api,'footer',{'version':0,'menus':[first,second]})
    assert call(api,'footer',{'version':saved.json()['version']},'publish').status_code==200
    assert public(api,host,'footer')[1]['label']=='Extracolumn'
    menu=Menu.objects.get(pk=second)
    menu.name='Updated resources';menu.save()
    assert public(api,host,'footer')[1]['label']=='Updated resources'
