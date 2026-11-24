"""Allow immutable media references from retained Site Document revisions."""
import importlib
from django.db import migrations

PREVIOUS = importlib.import_module("apps.media.migrations.0014_restore_guarded_processing_deletion").FORWARD
OLD = "OR EXISTS(SELECT 1 FROM api_post p WHERE p.sitecontent_ptr_id=r.content_id))"
NEW = "OR EXISTS(SELECT 1 FROM api_post p WHERE p.sitecontent_ptr_id=r.content_id) " \
      "OR EXISTS(SELECT 1 FROM cms_document d WHERE d.sitecontent_ptr_id=r.content_id))"
FORWARD = PREVIOUS.replace(OLD, NEW)
assert FORWARD != PREVIOUS

class Migration(migrations.Migration):
    dependencies = [("media", "0014_restore_guarded_processing_deletion"), ("cms", "0038_site_document")]
    operations = [migrations.RunSQL(FORWARD, PREVIOUS)]
