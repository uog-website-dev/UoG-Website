"""Local additive-migration rehearsal; refuse rollback if sidebar data exists."""
import hashlib
import json
import os
import sys
sys.path.insert(0, '/app')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django
django.setup()
from django.conf import settings
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from apps.cms.models import Page, Sidebar, PublishedContentSnapshot

assert settings.DEBUG and not Sidebar.objects.exists()

def digest():
    rows = list(Page.objects.order_by('pk').values('pk', 'site_id', 'title', 'layout', 'blocks', 'metadata'))
    snapshots = list(PublishedContentSnapshot.objects.order_by('pk').values('pk', 'payload'))
    return len(rows), len(snapshots), hashlib.sha256(json.dumps([rows, snapshots], default=str, sort_keys=True).encode()).hexdigest()

before = digest()
executor = MigrationExecutor(connection)
leaves = executor.loader.graph.leaf_nodes()
try:
    executor.migrate([('cms', '0022_retire_legacy_content_roles')])
    after_rollback = digest()
    assert before == after_rollback
finally:
    executor = MigrationExecutor(connection)
    executor.migrate(leaves)
assert digest() == before
print(json.dumps({'baseline': 'cms.0022 with existing legacy and visual Pages', 'pages': before[0], 'publication_snapshots': before[1], 'content_hash': before[2], 'rollback_retains_content': True, 'forward_retains_content': True, 'sidebar_table_initially_empty': True, 'result': 'PASS'}))
