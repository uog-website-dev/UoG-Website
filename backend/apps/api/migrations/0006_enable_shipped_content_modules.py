"""Enable the shipped content modules at the platform level."""
from django.db import migrations


FORWARD = """
UPDATE sites_module
   SET is_enabled = TRUE
 WHERE code IN ('PAGES', 'POSTS', 'MENUS')
   AND status = 'IMPLEMENTED'
   AND EXISTS (
       SELECT 1 FROM sites_module_implementation shipped
        WHERE shipped.code = sites_module.code
   );
"""

REVERSE = """
UPDATE sites_module
   SET is_enabled = FALSE
 WHERE code IN ('PAGES', 'POSTS', 'MENUS');
"""


class Migration(migrations.Migration):
    dependencies = [("api", "0005_post_taxonomy_sitecontent")]

    operations = [migrations.RunSQL(FORWARD, reverse_sql=REVERSE)]
