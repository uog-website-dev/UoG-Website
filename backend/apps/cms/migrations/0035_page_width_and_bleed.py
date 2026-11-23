"""Safe page width default and explicit, decoupled page bleed.

Pages used to treat `settings.content_width = "full"` as an implicit bleed.
The contract now carries `settings.bleed` separately, so the database guard is
rebuilt from the regenerated schema and existing documents may opt into it.

Existing `full` documents are **not** rewritten here. CMS content rows are
append-only: every metadata change must advance the revision counter and mint
an immutable revision through the content save service, so a schema migration
must not forge that history. Instead the shared resolver
(`frontend/packages/ui/src/page-width.ts`) treats stored `full` as the legacy
token — 100% of the available width, still inside the 24 px safe gutter and
never bleeding — and the Visual Builder labels it for conversion through the
normal draft/save pipeline, which only changes `settings` and therefore keeps
every row, column, widget and their order.
"""
from importlib import import_module
from pathlib import Path

from django.db import migrations

previous = import_module("apps.cms.migrations.0034_hero_information_cards")
old_schema = (
    Path(__file__).parent / "0034_layout_schema.json"
).read_text(encoding="utf-8").replace("'", "''")
new_schema = (
    Path(__file__).parent / "0035_layout_schema.json"
).read_text(encoding="utf-8").replace("'", "''")
SQL = previous.SQL.replace(old_schema, new_schema)
assert SQL != previous.SQL


class Migration(migrations.Migration):
    dependencies = [("cms", "0034_hero_information_cards")]
    operations = [
        # Reinstalls the layout guard with `settings.bleed` accepted. Reverse
        # restores the 0034 guard; stored `bleed` keys stay valid data and are
        # simply ignored by the older schema on the next write.
        migrations.RunSQL(SQL, previous.SQL),
    ]
