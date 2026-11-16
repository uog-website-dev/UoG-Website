"""Concurrent real HTTP reads against the isolated two-worker perf backend.

Pipe private configuration to stdin; output contains measurements only.
Requires DEBUG on the calling management shell and managed PERF001 fixtures.
"""
import concurrent.futures
import json
import math
import re
import sys
import time
import urllib.request
import uuid
from pathlib import Path
from django.conf import settings

assert settings.DEBUG
sys.path.insert(0, '/tmp')
from sprint3_live_review import Review

config = json.load(sys.stdin)
data = json.loads(Path('/tmp/perf001-session.json').read_text())
review = Review.__new__(Review)
review.config = lambda key, default=None: config.get(key, default)
token = review.token(data['actor']['username'], data['actor']['password'])
sites = [row['id'] for row in data['sites']]
assert len(sites) >= 20
paths = {
    'bootstrap': '/api/workspace/?site={site}',
    'switcher': '/api/workspace/sites/?page_size=20',
    'pages': '/api/v1/sites/{site}/pages/?page_size=20',
    'posts': '/api/v1/sites/{site}/posts/?page_size=20',
    'menus': '/api/v1/sites/{site}/menus/?page_size=20',
    'media': '/api/v1/sites/{site}/assets/?page_size=20',
    'dashboard': '/api/workspace/dashboard/?site={site}',
}

def read(kind, number):
    site = sites[number % len(sites)]
    request = urllib.request.Request('http://perf-backend:8000' + paths[kind].format(site=site),
        headers={'Authorization': 'Bearer ' + token, 'Host': 'localhost', 'X-Request-ID': str(uuid.uuid4())})
    started = time.perf_counter()
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
        body = json.loads(raw)
        assert response.status == 200
        if kind == 'bootstrap': assert body['site']['id'] == site
        if kind == 'dashboard': assert body['site'] == site and not body['partial']
        if kind in {'pages', 'posts', 'menus', 'media'}:
            assert len(body['results']) <= 20
            assert all(row['site'] == site for row in body['results'])
        timing = response.headers.get('Server-Timing', '')
        sql = re.search(r'sql;desc="(\d+)"', timing)
        db = re.search(r'db;dur=([\d.]+)', timing)
        assert sql and db, 'Perf instrumentation missing'
        return {'kind': kind, 'site': site, 'duration_ms': round((time.perf_counter()-started)*1000,3),
                'sql_count': int(sql[1]), 'sql_ms': float(db[1]), 'bytes': len(raw),
                'request_id': response.headers.get('X-Request-ID'),
                'cache_hit': body.get('cache',{}).get('hit')}

# Warm each endpoint before timed batches; no compilation or write load.
for kind in paths: read(kind, 0)
samples = []
for kind in paths:
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        samples.extend(pool.map(lambda n: read(kind,n), range(60)))
def pct(values,p): return sorted(values)[math.ceil(len(values)*p)-1]
summary = {}
for kind in paths:
    rows = [r for r in samples if r['kind']==kind]
    summary[kind] = {key: {'p50': pct([r[key] for r in rows],.5), 'p95': pct([r[key] for r in rows],.95)}
                     for key in ('duration_ms','sql_count','sql_ms','bytes')}
print(json.dumps({'method':'Real HTTP / PostgreSQL / Redis / Keycloak bearer; 4 concurrent clients; 60 reads per endpoint across 21 Sites; 2 synchronous Gunicorn workers',
                  'summary':summary,'samples':samples,'failures':[]}, indent=2))
