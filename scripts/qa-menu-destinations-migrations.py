"""Local 0025 -> 0026 rehearsal; never run against production."""
import hashlib,json
from django.conf import settings
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
assert settings.DEBUG

def digest():
    with connection.cursor() as c:
        c.execute('SELECT id,site_id,code,location,name,is_active,is_global,version,created_at,updated_at FROM cms_menu ORDER BY id'); menus=c.fetchall()
        c.execute('SELECT id,menu_id,site_id,label,item_type,page_id,post_id,target,parent_id,sort_order,is_active,allow_cross_site,created_at,updated_at FROM cms_menuitem ORDER BY id');items=c.fetchall()
    return {'menus':len(menus),'items':len(items),'sha256':hashlib.sha256(json.dumps([menus,items],default=str).encode()).hexdigest()}
before=digest();leaves=MigrationExecutor(connection).loader.graph.leaf_nodes()
try:
    MigrationExecutor(connection).migrate([('cms','0025_named_menu_directory')])
    assert before==digest()
finally:
    MigrationExecutor(connection).migrate(leaves)
assert before==digest()
print(json.dumps({'result':'PASS','baseline':'0025','target':'0026','identifiers_items_versions_assignments_unchanged':True,**before}))
