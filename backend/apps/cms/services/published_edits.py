"""Direct in-place edits of live published Pages and Posts.

Public readers consume publication snapshots. Saving a published record under
``apply_working_draft`` unlocks the content lock, then a fresh snapshot makes
the change visible immediately — without cloning a working draft.
"""
from contextlib import contextmanager

from django.db import connections, router, transaction

from apps.cms.models import ContentStatus, Page, apply_working_draft
from apps.cms.services.publication_cache import bump_publication_version
from apps.cms.services.workflow import (
    _apply_working_draft_database,
    _create_publication_snapshot,
    _workflow_database_write,
)


@contextmanager
def published_content_write(content):
    """Allow mutating a published row and refresh its public snapshot on exit."""
    using = content._state.db or router.db_for_write(type(content), instance=content)
    if content.status != ContentStatus.PUBLISHED:
        yield
        return
    with apply_working_draft(), _apply_working_draft_database(using=using):
        yield
        if connections[using].needs_rollback:
            return
        # Snapshot insert guards require the workflow/apply-draft flags; keep
        # them active so in-place edits can publish without a new approval.
        content.refresh_from_db(using=using)
        with _workflow_database_write(using=using):
            _create_publication_snapshot(content, using=using)
        if isinstance(content, Page):
            bump_publication_version(
                content.site_id, content.locale, path=content.path, using=using,
            )
        elif content._meta.model_name == "post":
            bump_publication_version(
                content.site_id,
                content.locale,
                path=f"/posts/{content.slug}",
                using=using,
            )


def save_published_instance(instance, *, taxonomy=None):
    """Persist ``instance`` and, when published, bump the public snapshot."""
    using = instance._state.db or router.db_for_write(type(instance), instance=instance)
    with transaction.atomic(using=using):
        with published_content_write(instance):
            if taxonomy is not None and hasattr(instance, "save"):
                instance.save(taxonomy=taxonomy)
            else:
                instance.save()
    return instance
