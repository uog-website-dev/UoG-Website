"""Rehearse additive guard replacement and its protected downgrade on local data."""
import json
from django.conf import settings
from django.db import connection, DatabaseError
from django.db.migrations.executor import MigrationExecutor
from apps.cms.models import Sidebar

assert settings.DEBUG
before = list(Sidebar.objects.order_by('pk').values('pk','site_id','name','version','components'))
assert before and all(component['type']=='menu' for row in before for component in row['components'])
executor = MigrationExecutor(connection)
leaves = executor.loader.graph.leaf_nodes()
try:
    executor.migrate([('cms','0023_reusable_sidebars')])
finally:
    MigrationExecutor(connection).migrate(leaves)
assert list(Sidebar.objects.order_by('pk').values('pk','site_id','name','version','components')) == before
source = Sidebar.objects.first()
probe = Sidebar.objects.create(site_id=source.site_id, name='Widget migration rollback probe', created_by=source.created_by, updated_by=source.updated_by, components=[{'id':'related','type':'related_pages','title':'Related','page_ids':[]}])
blocked = False
try:
    try:
        MigrationExecutor(connection).migrate([('cms','0023_reusable_sidebars')])
    except DatabaseError as error:
        blocked = 'Remove non-Menu' in str(error)
    assert blocked
finally:
    MigrationExecutor(connection).migrate(leaves)
    probe.delete()
print(json.dumps({'legacy_definitions_preserved':len(before),'forward_upgrade':'PASS','menu_only_rollback':'PASS','populated_widget_downgrade_guard':'PASS','result':'PASS'}))
