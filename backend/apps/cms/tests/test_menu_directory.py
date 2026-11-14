"""Named Menu identity is independent of optional navigation assignment."""
import pytest
from django.db import IntegrityError, transaction
from apps.audit.models import AuditEvent
from apps.cms.menu_models import Menu, MenuItem
from .test_menu_api import api, ready, _tag, _item  # noqa: F401

pytestmark = pytest.mark.django_db


def create(api, name, code=None, **extra):
    response = api.client.post(api.base, {'name':name, **({'code':code} if code is not None else {}), **extra}, content_type='application/json', **api.header)
    assert response.status_code == 201, response.content
    return response


def test_administrator_creates_selects_and_renames_multiple_unassigned_menus(api):
    first = create(api,'Student services')
    second = create(api,'Research navigation')
    assert first.json()['location'] == second.json()['location'] == ''
    assert first.json()['code'] == 'student-services'
    assert first.json()['id'] != second.json()['id']
    url = first['Location']
    _item(api,url,'Library',target='/library')
    original_items = list(MenuItem.objects.filter(menu_id=first.json()['id']).values())
    renamed = api.client.patch(url, {'name':'Student information'}, content_type='application/json', HTTP_IF_MATCH=_tag(api,url), **api.header)
    assert renamed.status_code == 200, renamed.content
    assert renamed.json()['id'] == first.json()['id']
    assert renamed.json()['code'] == 'student-services'
    assert list(MenuItem.objects.filter(menu_id=first.json()['id']).values()) == original_items
    directory = api.client.get(api.base, **api.header).json()
    assert directory['count'] == 2
    assert [row['name'] for row in directory['results']] == ['Research navigation','Student information']
    assert api.client.get(api.base+'?search=student-services', **api.header).json()['count'] == 1
    assert AuditEvent.objects.filter(entity_type='cms.menu',entity_id=first.json()['id']).exists()


def test_identifiers_are_site_unique_and_immutable_and_foreign_records_stay_scoped(api):
    first = create(api,'First','department')
    duplicate = api.client.post(api.base, {'name':'Second','code':'department'}, content_type='application/json', **api.header)
    assert duplicate.status_code in (400,409)
    foreign = Menu.objects.create(site=api.other,name='Foreign menu',code='department',location='')
    assert foreign.code == first.json()['code']
    assert api.client.get(api.base, **api.header).json()['count'] == 1
    foreign_url = api.base+str(foreign.pk)+'/'
    assert api.client.get(foreign_url, **api.header).status_code == 404
    assert api.client.patch(foreign_url, {'name':'Forbidden'}, content_type='application/json', HTTP_IF_MATCH=first['ETag'], **api.header).status_code == 404
    assert api.client.patch(first['Location'], {'code':'changed'}, content_type='application/json', HTTP_IF_MATCH=first['ETag'], **api.header).status_code == 400
    with pytest.raises(IntegrityError), transaction.atomic():
        Menu.objects.filter(pk=first.json()['id']).update(code='changed')
    assert Menu.objects.get(pk=foreign.pk).name == 'Foreign menu'


def test_retirement_preserves_items_and_unassigned_menus_do_not_replace_header(api):
    from .test_public_posts import _host
    header = create(api,'Header',location='header')
    _item(api,header['Location'],'Existing public link',target='/existing')
    activated = api.client.post(header['Location']+'activate/', {}, content_type='application/json', HTTP_IF_MATCH=_tag(api,header['Location']), **api.header)
    assert activated.status_code == 200
    extra = create(api,'Secondary navigation')
    _item(api,extra['Location'],'Separate link',target='/separate')
    api.client.post(extra['Location']+'activate/', {}, content_type='application/json', HTTP_IF_MATCH=_tag(api,extra['Location']), **api.header)
    host = _host(api.site)
    before = api.client.get('/api/v1/site-context/menus/?location=header',HTTP_HOST=host)
    assert before.status_code == 200 and b'Existing public link' in before.content
    assert b'Separate link' not in before.content
    retired = api.client.post(extra['Location']+'deactivate/', {}, content_type='application/json', HTTP_IF_MATCH=_tag(api,extra['Location']), **api.header)
    assert retired.status_code == 200 and retired.json()['is_active'] is False
    assert MenuItem.objects.filter(menu_id=extra.json()['id']).count() == 1
    after = api.client.get('/api/v1/site-context/menus/?location=header',HTTP_HOST=host)
    assert after.json() == before.json()


def test_unauthorized_and_module_disabled_requests_cannot_create_or_retire(api):
    from apps.authorization.models import UserRoleAssignment,Role
    from apps.sites.models import Module
    from apps.sites.services.modules import disable_module_for_site
    row = create(api,'Protected')
    assert api.client.post(api.base, {'name':'Anonymous'},content_type='application/json').status_code == 401
    UserRoleAssignment.objects.filter(user=api.user).delete()
    UserRoleAssignment.objects.create(user=api.user,role=Role.objects.get(code='viewer'),scope='SITE',site=api.site,organization=api.site.organization_unit)
    assert api.client.post(api.base,{'name':'Denied'},content_type='application/json',**api.header).status_code == 403
    assert api.client.post(row['Location']+'deactivate/',{},content_type='application/json',HTTP_IF_MATCH=row['ETag'],**api.header).status_code == 403
    UserRoleAssignment.objects.filter(user=api.user).delete()
    UserRoleAssignment.objects.create(user=api.user,role=Role.objects.get(code='site-administrator'),scope='SITE',site=api.site,organization=api.site.organization_unit)
    disable_module_for_site(api.site.pk,Module.objects.get(code='MENUS').pk)
    assert api.client.post(api.base,{'name':'Blocked'},content_type='application/json',**api.header).status_code == 400
    assert Menu.objects.filter(site=api.site).count() == 1
