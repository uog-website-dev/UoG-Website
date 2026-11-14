"""Approved sidebar sources share publication selectors and never disclose drafts."""
import copy
import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from apps.api.models import Post
from apps.cms.models import Page, Sidebar
from apps.cms.services import sidebars
from apps.cms.tests.support import transition_with_site_role
from .test_sidebars import region, world, publish  # noqa: F401
from .test_public_posts import _host

pytestmark = pytest.mark.django_db


def create_widget_sidebar(client, region, components):
    sites, _, headers, _ = region
    return client.post(f'/api/v1/sites/{sites[0].pk}/sidebars/', {'name':'Information sources','components':components}, content_type='application/json', **headers['editor'])


def test_mixed_sources_preserve_order_and_only_deliver_published_site_content(client, region):
    from .test_realm_role_authorization import _enable
    from apps.sites.models import Module
    from apps.sites.services.modules import disable_module_for_site
    sites, users, headers, menus = region
    _enable('POSTS', *sites)
    related = Page.objects.create(site=sites[0], title='Approved related Page', slug='approved-related', created_by=users['editor'])
    draft = Page.objects.create(site=sites[0], title='PRIVATE PAGE MARKER', slug='private-related', created_by=users['editor'])
    foreign = Page.objects.create(site=sites[1], title='FOREIGN PAGE MARKER', slug='foreign-related')
    publish(related, users)
    article = Post.objects.create(site=sites[0], title='Approved Site news', slug='approved-news', content='<p>News</p>', created_by=users['editor'])
    publish(article, users)
    Post.objects.create(site=sites[0], title='PRIVATE POST MARKER', slug='private-news', content='<p>Private</p>')
    foreign_post = Post.objects.create(site=sites[1], title='FOREIGN POST MARKER', slug='foreign-news', content='<p>Foreign</p>', created_by=users['editor'])
    publish(foreign_post, users)
    components = [
        {'id':'related','type':'related_pages','title':'Related information','page_ids':[str(draft.pk),str(related.pk)]},
        {'id':'news','type':'recent_posts','title':'Latest updates','limit':3},
        {'id':'navigation','type':'menu','menu_id':str(menus[0].pk)},
    ]
    response = create_widget_sidebar(client, region, components)
    assert response.status_code == 201, response.content
    sidebar = Sidebar.objects.get(pk=response.json()['id'])
    page = Page.objects.create(site=sites[0], title='Information', slug='widgets', layout='LEFT_SIDEBAR', sidebar=sidebar, created_by=users['editor'])
    publish(page, users)
    url = '/api/v1/site-context/pages/widgets/'
    host = _host(sites[0])
    public = client.get(url, HTTP_HOST=host)
    data = public.json()['sidebar_snapshot']['components']
    assert [row['id'] for row in data] == ['related','news','navigation']
    assert [item['label'] for item in data[0]['items']] == ['Approved related Page']
    assert [item['label'] for item in data[1]['items']] == ['Approved Site news']
    assert 'page_ids' not in data[0]
    assert str(draft.pk) not in public.content.decode()
    assert 'PRIVATE' not in public.content.decode() and 'FOREIGN' not in public.content.decode()
    disable_module_for_site(sites[0].pk, Module.objects.get(code='POSTS').pk)
    disabled = client.get(url, HTTP_HOST=host)
    assert disabled.status_code == 200
    news = disabled.json()['sidebar_snapshot']['components'][1]
    assert news['state'] == 'unavailable' and news['items'] == []
    assert 'Approved Site news' not in disabled.content.decode()
    assert disabled['ETag'] != public['ETag']
    transition_with_site_role(related, 'unpublish', users['publisher'])
    empty = client.get(url, HTTP_HOST=host).json()['sidebar_snapshot']['components'][0]
    assert empty['state'] == 'empty' and empty['items'] == []
    menus[0].refresh_from_db(); menus[0].is_active = False; menus[0].save()
    private_preview = client.get(f'/api/v1/sites/{sites[0].pk}/sidebars/{sidebar.pk}/', **headers['editor'])
    assert private_preview.status_code == 200
    assert private_preview.json()['snapshot']['components'][2]['state'] == 'unavailable'
    assert foreign.pk != related.pk


@pytest.mark.parametrize('kind', ['foreign-page','duplicate-page','unknown-field','invalid-limit','bool-limit','missing-title'])
def test_component_schema_and_foreign_reference_rejections_are_atomic(client, region, kind):
    from .test_realm_role_authorization import _enable
    sites, _, _, _ = region
    _enable('POSTS', sites[0])
    foreign = Page.objects.create(site=sites[1], title='Foreign', slug='foreign')
    own = Page.objects.create(site=sites[0], title='Own', slug='own')
    component = {'id':'related','type':'related_pages','title':'Related','page_ids':[]}
    if kind == 'foreign-page': component['page_ids'] = [str(foreign.pk)]
    if kind == 'duplicate-page': component['page_ids'] = [str(own.pk),str(own.pk)]
    if kind == 'unknown-field': component['site'] = sites[1].pk
    if kind in ('invalid-limit','bool-limit'): component = {'id':'news','type':'recent_posts','title':'News','limit':11 if kind=='invalid-limit' else True}
    if kind == 'missing-title': component.pop('title')
    response = create_widget_sidebar(client, region, [component])
    assert response.status_code == 400, response.content
    assert not Sidebar.objects.exists()


def test_empty_source_module_requirements_and_write_authorization(client, region):
    sites, users, headers, _ = region
    component = {'id':'related','type':'related_pages','title':'Related Pages','page_ids':[]}
    response = create_widget_sidebar(client, region, [component])
    assert response.status_code == 201, response.content
    assert response.json()['snapshot']['components'][0]['state'] == 'empty'
    for role in ('reviewer','publisher'):
        assert client.patch(f'/api/v1/sites/{sites[0].pk}/sidebars/{response.json()["id"]}/', {'components':[component]}, content_type='application/json', HTTP_IF_MATCH=response['ETag'], **headers[role]).status_code == 403
    row = Sidebar.objects.get(pk=response.json()['id'])
    with pytest.raises(ValidationError, match='POSTS must be enabled'):
        sidebars.write(site_id=sites[0].pk, actor=users['editor'], sidebar_id=row.pk, expected=row.version, data={'components':[{'id':'news','type':'recent_posts','title':'News','limit':5}]})
    with pytest.raises(IntegrityError), transaction.atomic():
        Sidebar.objects.filter(pk=row.pk).update(components=[{'id':'bad','type':'recent_posts','title':'News','limit':999}])


def test_downgrade_guard_includes_retained_page_snapshots_after_definition_change(client, region):
    from django.db import connection, DatabaseError
    from django.db.migrations.executor import MigrationExecutor
    sites, users, _, menus = region
    response = create_widget_sidebar(client, region, [{'id':'related','type':'related_pages','title':'Related','page_ids':[]}])
    assert response.status_code == 201
    row = Sidebar.objects.get(pk=response.json()['id'])
    Page.objects.create(site=sites[0], title='Retained widget draft', slug='retained-widget', layout='LEFT_SIDEBAR', sidebar=row, created_by=users['editor'])
    sidebars.write(site_id=sites[0].pk, sidebar_id=row.pk, actor=users['editor'], expected=row.version, data={'components':[{'id':'menu','type':'menu','menu_id':str(menus[0].pk)}]})
    executor = MigrationExecutor(connection)
    leaves = executor.loader.graph.leaf_nodes()
    try:
        with pytest.raises(DatabaseError, match='reconcile retained Page snapshots'), transaction.atomic():
            executor.migrate([('cms','0023_reusable_sidebars')])
    finally:
        MigrationExecutor(connection).migrate(leaves)
