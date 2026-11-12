from django.db import migrations
from apps.cms.blocks_sql import FORWARD
BASE = FORWARD.split("CREATE TRIGGER")[0].replace("CREATE FUNCTION cms_validate_blocks()", "CREATE OR REPLACE FUNCTION cms_validate_blocks()")
UPDATED = BASE.replace("'paragraph', 'section')", "'paragraph', 'section', 'slider', 'gallery')")
class Migration(migrations.Migration):
    dependencies = [("cms", "0012_page_working_draft")]
    operations = [migrations.RunSQL(UPDATED, BASE)]
