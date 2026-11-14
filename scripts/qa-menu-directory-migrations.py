"""Local additive migration rehearsal; preserve Menu/item identity and versions."""
import hashlib,json,uuid
from django.conf import settings
from django.db import connection,DatabaseError
from django.db.migrations.executor import MigrationExecutor
from apps.cms.menu_models import Menu,MenuItem
from apps.sites.selectors.modules import module_is_available

assert settings.DEBUG
fields=('id','site_id','location','name','is_active','is_global','version','created_at','updated_at')
def digest():
    rows=list(Menu.objects.order_by('id').values(*fields))
    items=list(MenuItem.objects.order_by('id').values())
    return len(rows),len(items),hashlib.sha256(json.dumps([rows,items],sort_keys=True,default=str).encode()).hexdigest()
assert not Menu.objects.filter(location='').exists()
before=digest()
leaves=MigrationExecutor(connection).loader.graph.leaf_nodes()
try:
    MigrationExecutor(connection).migrate([('cms','0024_sidebar_content_components')])
    assert digest()==before
finally:
    MigrationExecutor(connection).migrate(leaves)
assert digest()==before
owner=next(row.site for row in Menu.objects.select_related('site') if module_is_available(row.site_id,'MENUS'))
probe=Menu.objects.create(site=owner,name='Directory rollback probe',code='probe-'+uuid.uuid4().hex[:12],location='',is_active=False)
blocked=False
try:
    try: MigrationExecutor(connection).migrate([('cms','0024_sidebar_content_components')])
    except DatabaseError as error: blocked='Reconcile unassigned menus' in str(error)
    assert blocked
finally:
    MigrationExecutor(connection).migrate(leaves)
    probe.delete()
print(json.dumps({'menus_preserved':before[0],'items_preserved':before[1],'legacy_ids_assignments_and_versions_unchanged':True,'rollback_guard':'PASS','forward_and_rollback':'PASS','result':'PASS'}))
