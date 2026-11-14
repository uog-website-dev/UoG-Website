"""Preserve article references while restoring guarded pending/failed removal."""
import importlib
from django.db import migrations

PREVIOUS=importlib.import_module("apps.media.migrations.0013_post_revision_references").SQL
NEEDLE="IF TG_OP='UPDATE' AND NEW.status <> OLD.status AND NOT ("
FORWARD=PREVIOUS.replace(NEEDLE,NEEDLE+"(NEW.deleted_at IS NOT NULL AND NEW.status='ARCHIVED' AND current_setting('media.deleting',true)='on') OR ")
assert FORWARD!=PREVIOUS


class Migration(migrations.Migration):
    dependencies=[("media","0013_post_revision_references")]
    operations=[migrations.RunSQL(FORWARD,PREVIOUS)]
