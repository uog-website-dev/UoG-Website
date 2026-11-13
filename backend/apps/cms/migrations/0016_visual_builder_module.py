"""Ship VISUAL_BUILDER as a Site module that depends on PAGES.

Platform admins enable it globally like Pages/Posts/Menus. Site admins then
enable it per Site. Sites that already have PAGES enabled receive the builder
assignment so existing Visual Builder menus keep working after upgrade.
"""
from django.db import migrations


FORWARD = r"""
SELECT organizations_lock_hierarchy();

INSERT INTO sites_module_implementation (code) VALUES ('VISUAL_BUILDER')
ON CONFLICT (code) DO NOTHING;

INSERT INTO sites_module (
    code, name, description, status, is_enabled, configuration_schema, created_at, updated_at
) VALUES (
    'VISUAL_BUILDER',
    'Visual Page Builder',
    'Visual Page composition for Site Pages. Requires PAGES on the same Site.',
    'IMPLEMENTED',
    TRUE,
    '{"schema_version": 1, "properties": []}'::jsonb,
    NOW(),
    NOW()
)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    status = 'IMPLEMENTED',
    is_enabled = TRUE,
    updated_at = NOW();

INSERT INTO sites_moduledependency (module_id, requires_id, created_at)
SELECT builder.id, pages.id, NOW()
FROM sites_module builder
JOIN sites_module pages ON pages.code = 'PAGES'
WHERE builder.code = 'VISUAL_BUILDER'
ON CONFLICT ON CONSTRAINT module_dependency_uniq DO NOTHING;

INSERT INTO sites_sitemodule (site_id, module_id, is_enabled, configuration, created_at, updated_at)
SELECT pages_enablement.site_id, builder.id, TRUE, '{}'::jsonb, NOW(), NOW()
FROM sites_sitemodule pages_enablement
JOIN sites_module pages ON pages.id = pages_enablement.module_id AND pages.code = 'PAGES'
JOIN sites_module builder ON builder.code = 'VISUAL_BUILDER'
WHERE pages_enablement.is_enabled
ON CONFLICT (site_id, module_id) DO UPDATE
SET is_enabled = TRUE, updated_at = NOW();
"""

REVERSE = r"""
SELECT organizations_lock_hierarchy();

DELETE FROM sites_sitemodule
 WHERE module_id = (SELECT id FROM sites_module WHERE code = 'VISUAL_BUILDER');

DELETE FROM sites_moduledependency
 WHERE module_id = (SELECT id FROM sites_module WHERE code = 'VISUAL_BUILDER');

ALTER TABLE sites_module DISABLE TRIGGER module_registry_rules;
UPDATE sites_module
   SET status = 'PLANNED',
       is_enabled = FALSE,
       description = 'Registered visual page builder capability.'
 WHERE code = 'VISUAL_BUILDER';
ALTER TABLE sites_module ENABLE TRIGGER module_registry_rules;

DELETE FROM sites_module_implementation WHERE code = 'VISUAL_BUILDER';
"""


class Migration(migrations.Migration):
    dependencies = [
        ("cms", "0015_revision_bound_publication"),
        ("sites", "0010_published_homepage"),
    ]

    operations = [migrations.RunSQL(FORWARD, reverse_sql=REVERSE)]
