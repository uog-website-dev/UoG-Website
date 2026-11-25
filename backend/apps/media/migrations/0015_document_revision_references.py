"""Allow retained document assets to point at immutable CMS revisions."""
import importlib
from django.db import migrations

PREVIOUS = importlib.import_module("apps.media.migrations.0014_restore_guarded_processing_deletion").FORWARD
NEEDLE = "OR EXISTS(SELECT 1 FROM api_post p WHERE p.sitecontent_ptr_id=r.content_id))"
FORWARD = PREVIOUS.replace(NEEDLE, NEEDLE[:-1] + " OR EXISTS(SELECT 1 FROM cms_document d WHERE d.sitecontent_ptr_id=r.content_id))")
assert FORWARD != PREVIOUS

class Migration(migrations.Migration):
    # Keep the trigger migration on the Media branch. Plpgsql resolves the
    # cms_document reference when the guard executes, after the CMS schema
    # migrations have completed; adding a cross-app dependency here can leave
    # deployed databases with media.0015 recorded before cms.0038.
    dependencies = [('media','0014_restore_guarded_processing_deletion')]
    operations = [migrations.RunSQL(FORWARD, PREVIOUS)]
