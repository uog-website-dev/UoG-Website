"""Explicit page-owned chrome: `settings.chrome` accepts "global" (default) or "none".

The contract now separates site chrome from the page canvas. Existing documents
are not rewritten: they keep the default global header and footer, and the
builder only offers chrome widgets as legacy nodes. A Page may deliberately opt
out with `chrome: "none"`, which the shared renderer surfaces as an in-page
navigation bar and hides the shell header and footer.

CMS content rows are append-only, so this migration only rebuilds the database
layout guard from the regenerated schema; it never forges a revision. Reversing
restores the 0035 guard. Stored `chrome` keys remain valid data and are simply
ignored by the older schema on the next write.
"""
from importlib import import_module
from pathlib import Path

from django.db import migrations

previous = import_module("apps.cms.migrations.0035_page_width_and_bleed")
old_schema = (
    Path(__file__).parent / "0035_layout_schema.json"
).read_text(encoding="utf-8").replace("'", "''")
new_schema = (
    Path(__file__).parent / "0036_layout_schema.json"
).read_text(encoding="utf-8").replace("'", "''")
SQL = previous.SQL.replace(old_schema, new_schema)
assert SQL != previous.SQL


class Migration(migrations.Migration):
    dependencies = [("cms", "0035_page_width_and_bleed")]
    operations = [
        migrations.RunSQL(SQL, previous.SQL),
    ]
