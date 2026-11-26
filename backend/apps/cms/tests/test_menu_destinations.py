"""P4-MENU-002: typed destinations, private item drafts and atomic public promotion."""
import pytest
from django.db import IntegrityError,transaction
from apps.api.models import Category
from apps.cms.models import MenuItem
from apps.cms.services.pages import create_page
from apps.cms.tests.test_menu_api import api,ready,_menu,_item,_post,_tag
from apps.cms.tests.test_public_posts import _host,_publish
from apps.sites.models import Module
from apps.sites.services.modules import enable_module_for_site,disable_module_for_site

pytestmark=pytest.mark.django_db

def enable(api,code):
    enable_module_for_site(api.site.pk,Module.objects.get(code=code).pk)

def view(api,host):
    result=api.client.get('/api/v1/site-context/menus/?location=header',HTTP_HOST=host)
    assert result.status_code==200,result.content
    return result.json()['locations']['header']

def publish(api,url):
    return _post(api,url+'activate/',{},_tag(api,url))

def test_published_items_are_frozen_across_nested_draft_edit_reorder_and_delete(api):
    url=_menu(api);a=_item(api,url,'About');b=_item(api,url,'News')
    aid=api.client.get(a,**api.header).json()['id'];bid=api.client.get(b,**api.header).json()['id']
    host=_host(api.site)
    assert publish(api,url).status_code==200
    original=view(api,host)
    moved=_post(api,b+'move/',{'parent':aid,'position':0},_tag(api,url))
    assert moved.status_code==200,moved.content
    assert view(api,host)==original
    assert api.client.get(url,**api.header).json()['has_unpublished_changes'] is True
    from django.db import connection,DatabaseError
    from django.db.migrations.executor import MigrationExecutor
    with pytest.raises(DatabaseError,match='Reconcile unpublished menu item changes'),transaction.atomic():
        MigrationExecutor(connection).migrate([('cms','0025_named_menu_directory')])
    assert publish(api,url).status_code==200
    public=view(api,host)
    assert len(public)==1 and public[0]['children'][0]['label']=='News'
    assert api.client.delete(b,HTTP_IF_MATCH=_tag(api,url),**api.header).status_code==204
    assert view(api,host)==public
    assert publish(api,url).status_code==200
    assert view(api,host)[0]['children']==[]

def test_news_category_options_scope_and_disabled_module(api):
    enable(api,'POSTS')
    category=_publish(Category.objects.create(site=api.site,code='RESEARCH',name='Research'))
    foreign=Category.objects.create(site=api.other,code='FOREIGN',name='Foreign')
    url=_menu(api)
    for body in ({'label':'News','item_type':'news'},{'label':'Research','item_type':'category','category':str(category.pk)}):
        result=_post(api,url+'items/',body,_tag(api,url));assert result.status_code==201,result.content
        assert result.json()['destination_status']=='ready'
    before=MenuItem.objects.count();token=_tag(api,url)
    bad=_post(api,url+'items/',{'label':'Foreign','item_type':'category','category':str(foreign.pk)},token)
    assert bad.status_code==400 and MenuItem.objects.count()==before and _tag(api,url)==token
    choices=api.client.get(api.base+'targets/',**api.header).json()
    assert choices['categories']==[{'id':str(category.pk),'label':'Research'}]
    host=_host(api.site);assert publish(api,url).status_code==200
    assert [r['href'] for r in view(api,host)]==['/posts','/posts/categories/research']
    disable_module_for_site(api.site.pk,Module.objects.get(code='POSTS').pk)
    assert view(api,host)==[]
    assert api.client.get(api.base+'targets/',**api.header).json()['categories']==[]
    assert publish(api,url).status_code==400

def test_unavailable_page_warns_and_blocks_promotion_without_replacing_public(api):
    enable(api,'PAGES');url=_menu(api);_item(api,url,'Existing')
    host=_host(api.site);assert publish(api,url).status_code==200
    previous=view(api,host)
    page=create_page(site=api.site,title='Private draft',slug='private-draft')
    item=_post(api,url+'items/',{'label':'Draft page','item_type':'page','page':str(page.pk)},_tag(api,url))
    assert item.status_code==201 and item.json()['destination_status']=='unavailable'
    assert publish(api,url).status_code==400
    assert view(api,host)==previous
    assert api.client.get(api.base+'targets/',**api.header).json()['pages']==[]

def test_editor_can_change_items_but_cannot_promote_and_stale_reorder_is_atomic(api):
    """Finding 5: active-menu item edits need menu.write only; promote needs menu.publish."""
    from apps.authorization.models import UserRoleAssignment,Role
    url=_menu(api);a=_item(api,url,'First');b=_item(api,url,'Second')
    assert publish(api,url).status_code==200
    host=_host(api.site);previous=view(api,host)
    UserRoleAssignment.objects.filter(user=api.user).update(role=Role.objects.get(code='editor'))
    old=_tag(api,url);ids=[api.client.get(u,**api.header).json()['id'] for u in (a,b)]
    good=_post(api,url+'reorder/',{'parent':None,'items':list(reversed(ids))},old)
    assert good.status_code==200,good.content
    stale=_post(api,url+'reorder/',{'parent':None,'items':ids},old)
    assert stale.status_code==409
    assert [r['id'] for r in api.client.get(url+'tree/',**api.header).json()['items']]==list(reversed(ids))
    assert publish(api,url).status_code==403
    assert view(api,host)==previous

def test_cycle_url_and_raw_category_mismatch_have_no_side_effects(api):
    enable(api,'POSTS');url=_menu(api);a=_item(api,url,'Root');aid=api.client.get(a,**api.header).json()['id'];b=_item(api,url,'Child',parent=aid);bid=api.client.get(b,**api.header).json()['id']
    before=api.client.get(url+'tree/',**api.header).json();token=_tag(api,url)
    assert _post(api,a+'move/',{'parent':bid,'position':0},token).status_code==400
    assert _post(api,url+'items/',{'label':'Unsafe','item_type':'external','target':'javascript:alert(1)'},token).status_code==400
    assert api.client.get(url+'tree/',**api.header).json()==before and _tag(api,url)==token
    foreign=Category.objects.create(site=api.other,code='FOREIGN',name='Foreign')
    with pytest.raises(IntegrityError),transaction.atomic():
        MenuItem.objects.bulk_create([MenuItem(menu_id=url.rstrip('/').split('/')[-1],site=api.site,label='Forged',item_type='category',category=foreign,sort_order=1)])

def test_first_api_edit_freezes_a_trusted_active_menu(api):
    from apps.cms.models import Menu
    menu=Menu.objects.create(site=api.site,name='Imported',location='header',is_active=True)
    item=MenuItem.objects.create(menu=menu,site=api.site,label='Original',item_type='custom',target='/original')
    url=api.base+str(menu.pk)+'/'
    host=_host(api.site);previous=view(api,host)
    changed=api.client.patch(url+'items/'+str(item.pk)+'/',{'label':'Private revised label'},content_type='application/json',HTTP_IF_MATCH=_tag(api,url),**api.header)
    assert changed.status_code==200,changed.content
    menu.refresh_from_db();assert menu.published_items is not None
    assert view(api,host)==previous

def test_category_retargeting_advances_etag_and_audits_without_publishing(api):
    from apps.audit.models import AuditEvent
    enable(api,'POSTS');url=_menu(api)
    first=_publish(Category.objects.create(site=api.site,code='FIRST',name='First'))
    second=_publish(Category.objects.create(site=api.site,code='SECOND',name='Second'))
    item=_post(api,url+'items/',{'label':'News','item_type':'category','category':str(first.pk)},_tag(api,url))
    assert item.status_code==201
    old=_tag(api,url)
    changed=api.client.patch(item['Location'],{'category':str(second.pk)},content_type='application/json',HTTP_IF_MATCH=old,**api.header)
    assert changed.status_code==200,changed.content
    assert _tag(api,url)!=old
    event=AuditEvent.objects.filter(entity_id=item.json()['id'],action='MENU_ITEM_UPDATED').latest('timestamp')
    assert event.after['category_id']==str(second.pk)
