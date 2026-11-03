"""Add the published-Page working draft link and publication lock exception."""

from django.db import migrations, models
import django.db.models.deletion


def install_working_draft_locks(apps, schema_editor):
    """Replace the lock functions from the current workflow SQL source."""
    from apps.cms import workflow_sql

    schema_editor.execute(_lock_functions(workflow_sql.FORWARD))


def _lock_functions(sql):
    chunks = []
    for name, trigger in (
        ("cms_validate_workflow_write", "content_workflow_rules"),
        ("cms_protect_page_workflow_content", "page_workflow_content_rules"),
    ):
        start = sql.index(f"CREATE FUNCTION {name}")
        end = sql.index(f"CREATE TRIGGER {trigger}")
        chunks.append(
            sql[start:end].replace(
                "CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1,
            )
        )
    return "\n".join(chunks)


class Migration(migrations.Migration):

    dependencies = [
        ("cms", "0011_menu_delivery"),
    ]

    operations = [
        migrations.AddField(
            model_name="page",
            name="draft_of",
            field=models.ForeignKey(
                blank=True,
                help_text="Published Page this row revises. Empty for every public Page. A working draft is editable while that Page stays live.",
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="working_drafts",
                to="cms.page",
            ),
        ),
        migrations.RunPython(
            install_working_draft_locks,
            migrations.RunPython.noop,
        ),
    ]
