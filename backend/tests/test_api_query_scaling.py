"""PERF-007: bounded list reads without weakening live authorization."""
from datetime import timedelta

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from apps.api.models import Post, Category, Tag
from apps.authorization.models import Role, UserRoleAssignment
from apps.authorization.services import effective_permission_sets, permission_granted
from apps.cms.authorization import cms_grant_allows
from apps.cms.models import ContentRole, Page
from apps.cms.menu_models import Menu, MenuItem
from apps.cms.api.serializers import PageSerializer
from .test_dashboard import dashboard
from .test_workspace import world

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize('resource', ['pages', 'posts', 'menus'])
def test_list_queries_do_not_grow_per_record(dashboard, resource):
    client, actor, a, b, assignment = dashboard
    category = Category.objects.create(site=a, code='QUERY', name='Query', slug='query')
    tag = Tag.objects.create(site=a, code='QUERY', name='Query', slug='query')
    for i in range(21):
        if resource == 'pages':
            Page.objects.create(site=a, title=f'Query {i}', slug=f'query-{i}', created_by=actor, updated_by=actor)
        elif resource == 'posts':
            post = Post.objects.create(site=a, title=f'Query {i}', slug=f'query-{i}', content='<p>Safe article</p>', author=actor, created_by=actor, updated_by=actor)
            post.categories.add(category)
            post.tags.add(tag)
        else:
            menu = Menu.objects.create(site=a, name=f'Query {i}', code=f'query-{i}')
            MenuItem.objects.create(site=a, menu=menu, label='University', item_type='custom', target='/about', sort_order=0)
    path = f'/api/v1/sites/{a.pk}/{resource}/'
    counts = []
    for size in (1, 20):
        with CaptureQueriesContext(connection) as queries:
            result = client.get(path, {'page_size': size})
        assert result.status_code == 200, result.data
        assert len(result.data['results']) == size
        assert all(row['site'] == a.pk for row in result.data['results'])
        counts.append(len(queries))
    assert counts[1] <= counts[0] + 2, counts
    assert counts[1] <= 30, counts
    page1 = client.get(path, {'page_size': 10}).data
    page2 = client.get(path, {'page_size': 10, 'page': 2}).data
    assert page1['count'] == page2['count']
    assert not ({r['id'] for r in page1['results']} & {r['id'] for r in page2['results']})
    assert len(client.get(path, {'page_size': 999}).data.get('results', [])) <= 100


def test_serialization_snapshot_is_site_local_and_not_an_authorization_cache(dashboard):
    client, actor, a, b, assignment = dashboard
    a_page = Page.objects.filter(site=a).first()
    b_page = Page.objects.create(site=b, title='Private B', slug='private-b', created_by=actor, updated_by=actor)
    request = type('Request', (), {'user': actor})()
    data = PageSerializer([a_page, b_page], many=True, context={'request': request}).data
    assert data[0]['available_actions'] == ['submit']
    assert data[1]['available_actions'] == []
    assignment.revoked_at = timezone.now()
    assignment.save(update_fields=['revoked_at'])
    assert not cms_grant_allows(actor, a.pk, [ContentRole.AUTHOR])
    fresh = PageSerializer(a_page, context={'request': request}).data
    assert fresh['available_actions'] == []
    assert client.get(f'/api/v1/sites/{a.pk}/pages/').status_code == 403


def test_permission_filter_preserves_multiple_roles_and_expiry(world):
    _, actor, a, b, assignment = world
    for code in ('viewer', 'reviewer', 'publisher'):
        UserRoleAssignment.objects.create(user=actor, role=Role.objects.get(code=code), scope='SITE', site=a, organization=a.organization_unit)
    assert permission_granted(actor, 'sites.update', site_id=a.pk, audit=False)
    assignment.expires_at = timezone.now()-timedelta(seconds=1)
    assignment.save(update_fields=['expires_at'])
    assert not permission_granted(actor, 'sites.update', site_id=a.pk, audit=False)
    assert not permission_granted(actor, 'sites.update', site_id=b.pk, audit=False)
    assert 'sites.update' not in effective_permission_sets(actor, [(a.organization_unit_id,a.pk)])[0]


def test_organization_lookups_are_shared_only_within_one_evaluation(world):
    _, actor, a, b, assignment = world
    assignment.revoked_at = timezone.now()
    assignment.save(update_fields=['revoked_at'])
    root = a.organization_unit.parent
    for code in ('editor', 'reviewer', 'publisher'):
        UserRoleAssignment.objects.create(user=actor, role=Role.objects.get(code=code), scope='ORGANIZATION', organization=root)
    with CaptureQueriesContext(connection) as queries:
        result = effective_permission_sets(actor, [(a.organization_unit_id, a.pk)] * 3)
    assert all('content.pages.view' in permissions for permissions in result)
    assert len(queries) <= 5, [row['sql'] for row in queries]
    assert not cms_grant_allows(actor, a.pk, [ContentRole.AUTHOR])
    assert effective_permission_sets(actor, [(root.pk, a.pk)])[0] == []
