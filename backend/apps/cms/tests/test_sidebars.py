"""Reusable regions retain canonical ownership and revision-bound presentation."""
import copy
import pytest
from django.db import IntegrityError, transaction
from apps.cms.models import Page, Sidebar, Menu, MenuItem, PublishedContentSnapshot
from apps.cms.services.working_drafts import content_etag, open_working_draft
from apps.cms.tests.support import transition_with_site_role
from .test_page_shell_layouts import world  # noqa: F401
from .test_realm_role_authorization import _enable, PAGES
from .test_public_posts import _host

pytestmark = pytest.mark.django_db


@pytest.fixture
def region(world):
    sites, users, headers = world
    _enable('MENUS', *sites)
    menus = [Menu.objects.create(site=site, location='sidebar', name='Department navigation') for site in sites]
    MenuItem.objects.create(menu=menus[0], site=sites[0], label='University information', item_type='custom', target='/information')
    return sites, users, headers, menus


def create(client, region, name='Department sidebar'):
    sites, _, headers, menus = region
    response = client.post(f'/api/v1/sites/{sites[0].pk}/sidebars/', {
        'name': name, 'components': [{'id': 'navigation', 'type': 'menu', 'menu_id': str(menus[0].pk)}],
    }, content_type='application/json', **headers['editor'])
    assert response.status_code == 201, response.content
    return response


def assign(client, region, sidebar, slug='information'):
    sites, _, headers, _ = region
    response = client.post(PAGES.format(site=sites[0].pk), {
        'title': 'Information', 'slug': slug, 'layout': 'LEFT_SIDEBAR', 'sidebar': sidebar.json()['id'],
        'blocks': [{'type': 'paragraph', 'html': '<p>Original content</p>'}],
    }, content_type='application/json', **headers['editor'])
    assert response.status_code == 201, response.content
    return Page.objects.get(pk=response.json()['id'])


def publish(page, users):
    for action, role in [('submit', 'editor'), ('approve', 'reviewer'), ('publish', 'publisher')]:
        transition_with_site_role(page, action, users[role])
        page.refresh_from_db()


def test_reusable_assignment_roundtrip_and_published_snapshot_stability(client, region):
    sites, users, headers, _ = region
    sidebar = create(client, region)
    first = assign(client, region, sidebar)
    second = assign(client, region, sidebar, 'other-information')
    assert first.sidebar_id == second.sidebar_id
    assert Sidebar.objects.count() == 1
    publish(first, users)
    snapshot = copy.deepcopy(PublishedContentSnapshot.objects.get(content=first).payload)
    host = _host(sites[0])
    public = f'/api/v1/site-context/pages{first.path}/'
    assert client.get(public, HTTP_HOST=host).json()['sidebar_snapshot']['name'] == 'Department sidebar'
    renamed = client.patch(f'/api/v1/sites/{sites[0].pk}/sidebars/{first.sidebar_id}/', {'name': 'Renamed navigation'}, content_type='application/json', HTTP_IF_MATCH=sidebar['ETag'], **headers['editor'])
    assert renamed.status_code == 200, renamed.content
    assert renamed.json()['version'] == sidebar.json()['version'] + 1
    assert client.get(public, HTTP_HOST=host).json()['sidebar_snapshot']['name'] == 'Department sidebar'
    assert PublishedContentSnapshot.objects.get(content=first).payload == snapshot
    draft, _ = open_working_draft(first, actor=users['editor'])
    changed = client.patch(PAGES.format(site=sites[0].pk)+str(draft.pk)+'/', {'sidebar': None}, content_type='application/json', HTTP_IF_MATCH=content_etag(draft), **headers['editor'])
    assert changed.status_code == 200, changed.content
    assert client.get(public, HTTP_HOST=host).json()['sidebar_id'] == str(first.sidebar_id)


@pytest.mark.parametrize('kind', ['foreign', 'duplicate-id', 'duplicate-menu', 'unknown-type', 'empty', 'inactive'])
def test_invalid_components_are_atomic_and_field_addressed(client, region, kind):
    sites, _, headers, menus = region
    components = [{'id': 'navigation', 'type': 'menu', 'menu_id': str(menus[0].pk)}]
    if kind == 'foreign': components[0]['menu_id'] = str(menus[1].pk)
    if kind == 'duplicate-id': components += [copy.deepcopy(components[0])]
    if kind == 'duplicate-menu': components += [{**components[0], 'id': 'other'}]
    if kind == 'unknown-type': components[0]['type'] = 'script'
    if kind == 'empty': components = []
    if kind == 'inactive': menus[0].refresh_from_db(); menus[0].is_active = False; menus[0].save()
    response = client.post(f'/api/v1/sites/{sites[0].pk}/sidebars/', {'name': 'Invalid', 'components': components}, content_type='application/json', **headers['editor'])
    assert response.status_code == 400, response.content
    assert 'components' in str(response.json()['error']['details'])
    assert not Sidebar.objects.exists()


def test_foreign_assignment_permissions_and_protected_deletion(client, region):
    sites, _, headers, _ = region
    sidebar = create(client, region)
    page = assign(client, region, sidebar)
    url = f'/api/v1/sites/{sites[0].pk}/sidebars/{page.sidebar_id}/'
    response = client.delete(url, HTTP_IF_MATCH=sidebar['ETag'], **headers['editor'])
    assert response.status_code == 400 and Sidebar.objects.filter(pk=page.sidebar_id).exists()
    for role in ('reviewer', 'publisher'):
        assert client.patch(url, {'name': 'Forbidden'}, content_type='application/json', HTTP_IF_MATCH=sidebar['ETag'], **headers[role]).status_code == 403
        assert client.delete(url, HTTP_IF_MATCH=sidebar['ETag'], **headers[role]).status_code == 403
        assert client.post(f'/api/v1/sites/{sites[0].pk}/sidebars/', {'name': 'Forbidden'}, content_type='application/json', **headers[role]).status_code == 403
    assert client.get(url).status_code in (401, 403)
    assert client.get(url.replace(f'/{sites[0].pk}/', f'/{sites[1].pk}/'), **headers['editor']).status_code in (403, 404)
    with pytest.raises(IntegrityError), transaction.atomic():
        Page.objects.filter(pk=page.pk).update(sidebar_id=Sidebar.objects.create(site=sites[1], name='Foreign', created_by=region[1]['editor'], updated_by=region[1]['editor'], components=[{'id': 'foreign', 'type': 'menu', 'menu_id': str(region[3][1].pk)}]).pk)
    with pytest.raises(IntegrityError), transaction.atomic():
        Sidebar.objects.filter(pk=page.sidebar_id).update(site_id=sites[1].pk)


def test_sidebar_version_conflict_archive_and_unused_deletion(client, region):
    sites, _, headers, _ = region
    created = create(client, region)
    url = f'/api/v1/sites/{sites[0].pk}/sidebars/{created.json()["id"]}/'
    assert client.patch(url, {'name': 'Next'}, content_type='application/json', **headers['editor']).status_code == 428
    updated = client.patch(url, {'name': 'Next'}, content_type='application/json', HTTP_IF_MATCH=created['ETag'], **headers['editor'])
    assert updated.status_code == 200
    assert client.patch(url, {'name': 'Stale'}, content_type='application/json', HTTP_IF_MATCH=created['ETag'], **headers['editor']).status_code == 409
    assert client.delete(url, HTTP_IF_MATCH=created['ETag'], **headers['editor']).status_code == 409
    archived = client.patch(url, {'status': 'ARCHIVED'}, content_type='application/json', HTTP_IF_MATCH=updated['ETag'], **headers['editor'])
    assert archived.status_code == 200
    assert client.delete(url, HTTP_IF_MATCH=archived['ETag'], **headers['editor']).status_code == 204


def test_changed_dependency_blocks_publication_and_module_gate_hides_cached_sidebar(client, region):
    from apps.sites.models import Module
    from apps.sites.services.modules import disable_module_for_site
    from django.core.exceptions import ValidationError
    sites, users, headers, menus = region
    sidebar = create(client, region)
    page = assign(client, region, sidebar)
    publish(page, users)
    draft, _ = open_working_draft(page, actor=users['editor'])
    transition_with_site_role(draft, 'submit', users['editor']); draft.refresh_from_db()
    transition_with_site_role(draft, 'approve', users['reviewer']); draft.refresh_from_db()
    item = menus[0].items.get(); item.label = 'New label'; item.save()
    before = PublishedContentSnapshot.objects.get(content=page).payload
    with pytest.raises(ValidationError, match='Sidebar or Menu content changed'):
        transition_with_site_role(draft, 'publish', users['publisher'])
    assert PublishedContentSnapshot.objects.get(content=page).payload == before
    host = _host(sites[0]); url = f'/api/v1/site-context/pages{page.path}/'
    assert client.get(url, HTTP_HOST=host).json()['sidebar_snapshot']
    disable_module_for_site(sites[0].pk, Module.objects.get(code='MENUS').pk)
    assert client.get(url, HTTP_HOST=host).json()['sidebar_snapshot'] == {}
    disable_module_for_site(sites[0].pk, Module.objects.get(code='VISUAL_BUILDER').pk)
    disable_module_for_site(sites[0].pk, Module.objects.get(code='PAGES').pk)
    assert client.post(f'/api/v1/sites/{sites[0].pk}/sidebars/', {}, content_type='application/json', **headers['editor']).status_code == 400


def test_assignment_and_definition_validation_never_changes_foreign_or_locked_data(client, region):
    sites, users, headers, menus = region
    own = create(client, region)
    page = assign(client, region, own)
    foreign = Sidebar.objects.create(site=sites[1], name='Foreign', created_by=users['editor'], updated_by=users['editor'], components=[{'id': 'foreign', 'type': 'menu', 'menu_id': str(menus[1].pk)}])
    url = PAGES.format(site=sites[0].pk)+str(page.pk)+'/'
    for payload in ({'sidebar': str(foreign.pk)}, {'sidebar_snapshot': {'name': 'Forged'}}, {'layout': 'FULL_WIDTH'}):
        response = client.patch(url, payload, content_type='application/json', HTTP_IF_MATCH=content_etag(page), **headers['editor'])
        assert response.status_code == 400, response.content
        page.refresh_from_db()
        assert str(page.sidebar_id) == own.json()['id']
        assert page.sidebar_snapshot['name'] == 'Department sidebar'
    sidebar_url = f'/api/v1/sites/{sites[0].pk}/sidebars/{page.sidebar_id}/'
    response = client.patch(sidebar_url, {'status': 'ARCHIVED'}, content_type='application/json', HTTP_IF_MATCH=own['ETag'], **headers['editor'])
    assert response.status_code == 400
    publish(page, users)
    response = client.patch(url, {'sidebar': None}, content_type='application/json', HTTP_IF_MATCH=content_etag(page), **headers['editor'])
    assert response.status_code == 400
    with pytest.raises(IntegrityError), transaction.atomic():
        Page.objects.filter(pk=page.pk).update(sidebar_id=None)
    assert Page.objects.get(pk=page.pk).sidebar_id == page.sidebar_id


def test_inactive_menu_withdraws_cached_sidebar_without_changing_page_snapshot(client, region):
    sites, users, _, menus = region
    created = create(client, region)
    page = assign(client, region, created)
    publish(page, users)
    host = _host(sites[0]); url = f'/api/v1/site-context/pages{page.path}/'
    original = client.get(url, HTTP_HOST=host)
    assert original.json()['sidebar_snapshot']
    frozen = copy.deepcopy(PublishedContentSnapshot.objects.get(content=page).payload)
    menus[0].refresh_from_db(); menus[0].is_active = False; menus[0].save()
    withdrawn = client.get(url, HTTP_HOST=host)
    assert withdrawn.json()['sidebar_snapshot'] == {}
    assert withdrawn['ETag'] != original['ETag']
    assert withdrawn.json()['blocks'] == original.json()['blocks']
    assert PublishedContentSnapshot.objects.get(content=page).payload == frozen
    menus[0].is_active = True; menus[0].save()
    assert client.get(url, HTTP_HOST=host).json()['sidebar_snapshot'] == original.json()['sidebar_snapshot']
