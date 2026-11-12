"""Retain retry budgets even if another internal writer attempts a reset."""
import importlib
from django.db import migrations

BASE = importlib.import_module("apps.media.migrations.0007_processing_integrity").SQL.split("CREATE TRIGGER")[0].replace("CREATE FUNCTION media_processing_guard()", "CREATE OR REPLACE FUNCTION media_processing_guard()")
GUARD = "    IF TG_TABLE_NAME='media_mediaprocessing' THEN\n        IF TG_OP='DELETE' THEN\n            RAISE EXCEPTION 'Retain the durable retry ledger.' USING ERRCODE='23514', CONSTRAINT='media_processing_retained';\n        END IF;\n        IF NEW.state NOT IN ('QUEUED','PROCESSING','RETRY','READY','FAILED') OR\n           (TG_OP='UPDATE' AND (NEW.attempts < OLD.attempts OR\n             (OLD.state IN ('READY','FAILED') AND (NEW.state,NEW.attempts,NEW.token) IS DISTINCT FROM (OLD.state,OLD.attempts,OLD.token)))) THEN\n            RAISE EXCEPTION 'Retry counts are monotonic and terminal states cannot reset.' USING ERRCODE='23514', CONSTRAINT='media_processing_terminal';\n        END IF;\n    END IF;\n"
FORWARD = BASE.replace("    IF TG_TABLE_NAME='media_mediaprocessing' AND TG_OP='INSERT' THEN", GUARD + "    IF TG_TABLE_NAME='media_mediaprocessing' AND TG_OP='INSERT' THEN")

class Migration(migrations.Migration):
    dependencies = [("media", "0007_processing_integrity")]
    operations = [migrations.RunSQL(FORWARD, BASE)]
