"""Register the optional DOCUMENTS module, dependent on private MEDIA."""
from django.db import migrations

FORWARD = r"""
SELECT organizations_lock_hierarchy();
INSERT INTO sites_module_implementation(code) VALUES('DOCUMENTS') ON CONFLICT DO NOTHING;
INSERT INTO sites_module(code,name,description,status,is_enabled,configuration_schema,created_at,updated_at)
VALUES('DOCUMENTS','Documents','Site-owned document records and publishing workflow. Requires MEDIA.', 'IMPLEMENTED', TRUE, '{"schema_version":1,"properties":[]}'::jsonb,NOW(),NOW())
ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,status='IMPLEMENTED',is_enabled=TRUE,updated_at=NOW();
INSERT INTO sites_moduledependency(module_id,requires_id,created_at)
SELECT d.id,m.id,NOW() FROM sites_module d JOIN sites_module m ON m.code='MEDIA' WHERE d.code='DOCUMENTS'
ON CONFLICT ON CONSTRAINT module_dependency_uniq DO NOTHING;
"""
REVERSE = r"""
SELECT organizations_lock_hierarchy();
DELETE FROM sites_sitemodule WHERE module_id=(SELECT id FROM sites_module WHERE code='DOCUMENTS');
DELETE FROM sites_moduledependency WHERE module_id=(SELECT id FROM sites_module WHERE code='DOCUMENTS');
ALTER TABLE sites_module DISABLE TRIGGER module_registry_rules;
UPDATE sites_module SET status='PLANNED',is_enabled=FALSE,description='Registered Site document administration.' WHERE code='DOCUMENTS';
ALTER TABLE sites_module ENABLE TRIGGER module_registry_rules;
DELETE FROM sites_module_implementation WHERE code='DOCUMENTS';
"""

class Migration(migrations.Migration):
    dependencies = [('cms','0039_document_categories'),('sites','0016_footer_header_publication')]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
