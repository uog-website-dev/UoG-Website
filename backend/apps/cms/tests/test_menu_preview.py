"""Private draft rendering uses the same guarded projection without public effects."""
import pytest
from apps.cms.models import Menu,MenuItem
from .test_menu_api import api,ready,_menu,_item,_post,_tag
from .test_menu_locations import call,create,public
from .test_public_posts import _host
from .test_menu_delivery import family
pytestmark=pytest.mark.django_db


@pytest.mark.parametrize("debug",[True,False])
def test_working_menu_preview_is_private_and_does_not_change_published_output(api,settings,debug):
    settings.DEBUG=debug
    from apps.cms.menu_cache import delivery_version
    url=_menu(api);item=_item(api,url,'Published label');host=_host(api.site)
    assert _post(api,url+'activate/',{},_tag(api,url)).status_code==200
    previous=public(api,host)
    from apps.authorization.models import UserRoleAssignment,Role
    UserRoleAssignment.objects.filter(user=api.user).update(role=Role.objects.get(code='editor'))
    response=api.client.patch(item,{'label':'Private review label'},content_type='application/json',HTTP_IF_MATCH=_tag(api,url),**api.header)
    assert response.status_code==200
    version=delivery_version(api.site.pk,'header');tag=_tag(api,url)
    preview=api.client.get(url+'preview/',**api.header)
    assert preview.status_code==200,preview.content
    assert preview.json()['locations']['header'][0]['label']=='Private review label'
    assert preview.json()['public_origin']==('http://' if debug else 'https://')+host
    assert preview['Cache-Control']=='private, no-store'
    assert 'Authorization' in preview['Vary'] and 'noindex' in preview['X-Robots-Tag']
    assert public(api,host)==previous
    assert delivery_version(api.site.pk,'header')==version and _tag(api,url)==tag
    assert b'Private review label' not in api.client.get('/api/v1/site-context/menus/?location=header',HTTP_HOST=host).content


def test_preview_follows_saved_assignment_draft_including_null_without_promoting(api):
    create(api,'Original','header');next_menu=create(api,'Replacement');host=_host(api.site)
    before=public(api,host)
    saved=call(api,'header',{'version':0,'menu':next_menu,'replace':True});assert saved.status_code==200
    endpoint=api.base+'preview-navigation/'
    result=api.client.get(endpoint,**api.header);assert result.status_code==200,result.content
    assert result.json()['locations']['header'][0]['label']=='Replacement'
    assert public(api,host)==before
    assert call(api,'header',{'version':saved.json()['version'],'menu':None}).status_code==200
    assert api.client.get(endpoint,**api.header).json()['locations']['header']==[]
    assert public(api,host)==before


def test_unpublished_destinations_are_unlinked_in_private_preview_and_absent_publicly(api):
    from apps.cms.services.pages import create_page
    url=_menu(api);page=create_page(site=api.site,title='Unpublished page',slug='private-page')
    result=_post(api,url+'items/',{'label':'Review only','item_type':'page','page':str(page.pk)},_tag(api,url));assert result.status_code==201
    preview=api.client.get(url+'preview/',**api.header)
    node=preview.json()['locations']['header'][0]
    assert node['label']=='Review only' and node['href']=='' and node['destination_status']=='unavailable'
    host=_host(api.site);assert public(api,host)==[]


def test_unauthorized_and_foreign_previews_do_not_disclose_content(api):
    from apps.authorization.models import UserRoleAssignment,Role
    foreign=Menu.objects.create(site=api.other,name='Foreign secret',location='',is_active=False)
    MenuItem.objects.create(site=api.other,menu=foreign,label='Foreign draft item',item_type='custom',target='/private')
    assert api.client.get(api.base+'preview-navigation/').status_code==401
    result=api.client.get(api.base+str(foreign.pk)+'/preview/',**api.header)
    assert result.status_code==404 and b'Foreign draft item' not in result.content
    result=api.client.get(f'/api/v1/sites/{api.other.pk}/menus/preview-navigation/',**api.header)
    assert result.status_code==403 and b'Foreign' not in result.content
    UserRoleAssignment.objects.filter(user=api.user).update(role=Role.objects.get(code='viewer'))
    assert api.client.get(api.base+'preview-navigation/',**api.header).status_code==403


def test_disabled_module_blocks_private_and_public_and_extra_scope_parameters_are_rejected(api):
    from apps.sites.models import Module
    from apps.sites.services.modules import disable_module_for_site
    host=_host(api.site)
    assert api.client.get(api.base+'preview-navigation/?site='+str(api.other.pk),**api.header).status_code==400
    disable_module_for_site(api.site.pk,Module.objects.get(code='MENUS').pk)
    assert api.client.get(api.base+'preview-navigation/',**api.header).status_code==400
    assert api.client.get('/api/v1/site-context/menus/',HTTP_HOST=host).status_code==404


def test_approved_inheritance_qualifies_links_without_exposing_parent_drafts(api,family):
    from apps.cms.models import MenuInheritance
    from apps.cms.menu_destinations import snapshot_items
    main,_,child,_=family
    menu=Menu.objects.create(site=main,location='header',name='Approved shared navigation')
    item=MenuItem.objects.create(site=main,menu=menu,label='Approved parent label',item_type='custom',target='/parent')
    menu.published_items=snapshot_items(menu);menu.save(update_fields=['published_items'])
    item.label='Parent private draft';item.save()
    MenuInheritance.objects.create(site=child,location='header',inherit_from=main,local_precedence='append')
    result=api.client.get(api.base+'preview-navigation/',**api.header)
    assert result.status_code==200,result.content
    node=result.json()['locations']['header'][0]
    assert node['label']=='Approved parent label'
    assert node['href']==f'https://site-{main.pk}.uog.edu.et/parent'
    assert b'Parent private draft' not in result.content


def test_public_projection_omits_foreign_and_unpublished_branches(api,pages_module):
    from apps.cms.services.pages import create_page
    from .test_public_posts import _publish
    _host(api.other)
    foreign=_publish(create_page(site=api.other,title='Foreign published page',slug='foreign-page'))
    menu=Menu.objects.create(site=api.site,name='Local public',location='header')
    root=MenuItem.objects.create(menu=menu,site=api.site,label='Foreign content',item_type='page',page=foreign,allow_cross_site=True)
    MenuItem.objects.create(menu=menu,site=api.site,parent=root,label='Hidden descendant',item_type='custom',target='/descendant')
    MenuItem.objects.create(menu=menu,site=api.site,label='Local visible',item_type='custom',target='/visible',sort_order=1)
    host=_host(api.site)
    response=api.client.get('/api/v1/site-context/menus/?location=header',HTTP_HOST=host)
    assert response.status_code==200
    assert [node['label'] for node in response.json()['locations']['header']]==['Local visible']
    assert b'Foreign content' not in response.content and b'Hidden descendant' not in response.content
