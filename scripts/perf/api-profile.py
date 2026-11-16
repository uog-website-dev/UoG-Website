"""Read-only SQL profile on managed PERF001 data; run via manage.py shell.

Uses authenticated DRF requests in process (not an HTTP latency benchmark).
Plans omit literal filters/output; neither credentials nor content are emitted.
"""
import hashlib
import json
import re
import time
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient
from apps.authorization.services import effective_permission_sets
from apps.sites.models import Site

assert settings.DEBUG
private = json.loads(Path('/tmp/perf001-session.json').read_text())
actor = get_user_model().objects.get(pk=private['actor_id'])
sites = list(Site.objects.filter(code__startswith='PERF001-').order_by('code'))
assert len(sites) >= 20 and actor.is_active
site = sites[0]
client = APIClient(HTTP_HOST='localhost')
client.force_authenticate(actor)
paths = {
    'bootstrap': f'/api/workspace/?site={site.pk}',
    'switcher': '/api/workspace/sites/?page_size=20',
    'pages': f'/api/v1/sites/{site.pk}/pages/?page_size=20',
    'posts': f'/api/v1/sites/{site.pk}/posts/?page_size=20',
    'menus': f'/api/v1/sites/{site.pk}/menus/?page_size=20',
    'media': f'/api/v1/sites/{site.pk}/assets/?page_size=20',
    'dashboard': f'/api/workspace/dashboard/?site={site.pk}',
    'dashboard_cold': f'/api/workspace/dashboard/?site={site.pk}',
    'pages_status_recent': f'/api/v1/sites/{site.pk}/pages/?status=DRAFT&ordering=-updated_at&page_size=20',
    'posts_status_recent': f'/api/v1/sites/{site.pk}/posts/?status=PUBLISHED&ordering=-updated_at&page_size=20',
    'media_ready': f'/api/v1/sites/{site.pk}/assets/?ready_images=true&page_size=20',
    'switcher_search': '/api/workspace/sites/?search=Performance&page_size=20',
}

def plan_nodes(node):
    keys = ('Node Type', 'Relation Name', 'Index Name', 'Plan Rows', 'Actual Rows',
            'Actual Loops', 'Actual Total Time', 'Shared Hit Blocks', 'Shared Read Blocks', 'Sort Method')
    return {**{key: node[key] for key in keys if key in node},
            'Plans': [plan_nodes(child) for child in node.get('Plans', [])]}

results = {}
for name, path in {**paths, 'permissions': None}.items():
    runs, captured = [], []
    for _ in range(5):
        if name == 'dashboard_cold':
            from apps.core.dashboard_cache import invalidate
            invalidate(site.pk)
        with CaptureQueriesContext(connection) as queries:
            started = time.perf_counter()
            if path:
                response = client.get(path)
                assert response.status_code == 200, (name, response.status_code)
            else:
                effective_permission_sets(actor, [(None, None), (site.organization_unit_id, site.pk)])
            elapsed = (time.perf_counter() - started) * 1000
        captured = list(queries)
        runs.append({'duration_ms': round(elapsed, 3), 'sql_count': len(queries),
                     'sql_ms': round(sum(float(q['time']) * 1000 for q in queries), 3)})
    groups = {}
    for query in captured:
        sql = query['sql']
        shape = re.sub(r"'(?:[^']|'')*'", '?', sql)
        shape = re.sub(r'\b\d+\b', '?', shape)
        key = hashlib.sha256(shape.encode()).hexdigest()[:16]
        entry = groups.setdefault(key, {'shape': shape, 'calls': 0, 'sql_ms': 0, 'sql': sql})
        entry['calls'] += 1
        entry['sql_ms'] += float(query['time']) * 1000
    for entry in groups.values():
        sql = entry.pop('sql')
        if sql.lstrip().upper().startswith(('SELECT', 'WITH')) and 'FOR UPDATE' not in sql.upper():
            with connection.cursor() as cursor:
                cursor.execute('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql)
                plan = cursor.fetchone()[0][0]
            entry['plan'] = plan_nodes(plan['Plan'])
            entry['execution_ms'] = plan['Execution Time']
    results[name] = {'runs': runs, 'queries': list(groups.values())}
print(json.dumps({'method': 'DRF in-process SQL profile, 5 sequential reads; real PostgreSQL/Redis',
                  'sites': len(sites), 'results': results}, indent=2))
