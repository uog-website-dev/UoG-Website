"""Local baseline and guarded rollback rehearsal; no content is deleted."""
import json,hashlib
from django.conf import settings
from django.db import connection,transaction,DatabaseError
from django.db.migrations.executor import MigrationExecutor
assert settings.DEBUG

def digest():
    with connection.cursor() as c:
        c.execute('SELECT * FROM cms_menu ORDER BY id');menus=c.fetchall()
        c.execute('SELECT * FROM cms_menuitem ORDER BY id');items=c.fetchall()
    return {'menus':len(menus),'items':len(items),'sha256':hashlib.sha256(json.dumps([menus,items],default=str).encode()).hexdigest()}
leaves=MigrationExecutor(connection).loader.graph.leaf_nodes();before=digest()
try:
    MigrationExecutor(connection).migrate([('cms','0026_menu_destinations_and_publication'),('sites','0011_merge_homepage_module_deactivation')])
    assert digest()==before
finally:MigrationExecutor(connection).migrate(leaves)
assert digest()==before
from apps.cms.models import MenuLocationAssignment
from apps.sites.models import Site
from apps.sites.selectors.modules import module_is_available
site=next(s for s in Site.objects.all() if module_is_available(s.pk,'MENUS'))
class UndoProbe(Exception):pass
try:
    with transaction.atomic():
        MenuLocationAssignment.objects.bulk_create([MenuLocationAssignment(site=site,location='header')])
        try:
            with transaction.atomic():MigrationExecutor(connection).migrate([('cms','0026_menu_destinations_and_publication')])
        except DatabaseError as error:assert 'Reconcile menu location mappings' in str(error)
        else:raise AssertionError('Unsafe downgrade was permitted')
        raise UndoProbe()
except UndoProbe:pass
assert not MenuLocationAssignment.objects.exists()
print(json.dumps({'result':'PASS','baseline':'cms0026/sites0011','target':'cms0027/sites0012','data_preserved':before,'rollback_guard':'PASS'}))
