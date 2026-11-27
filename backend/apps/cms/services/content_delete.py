"""Permanent removal of draft, unpublished and archived SiteContent.

Published rows must be archived (or unpublished) first. Rows that once
published keep PROTECT history (snapshots, workflow) and a database trigger
that blocks naive deletes; this service clears that history under the
``cms.content_delete`` transaction flag, then removes the content row.
"""
from django.core.exceptions import ValidationError
from django.db import router, transaction
from django.db.models import ProtectedError, Q

from apps.organizations.hierarchy_lock import hierarchy_write

from ..models import (
    ContentRevision,
    ContentStatus,
    ContentWorkflowTransition,
    Page,
    PublishedContentSnapshot,
)
from .revisions import content_revision_delete

REMOVABLE_STATUSES = frozenset({
    ContentStatus.DRAFT,
    ContentStatus.IN_REVIEW,
    ContentStatus.UNPUBLISHED,
    ContentStatus.ARCHIVED,
})


def hard_delete_content(content):
    """Permanently delete removable SiteContent, including publication history.

    Raises ``ValidationError`` when the row is still live/published, and
    ``ProtectedError`` when child pages still reference it.
    """
    if content.status not in REMOVABLE_STATUSES:
        raise ValidationError({
            "status": (
                "Archive the content before permanently deleting it, or "
                "delete only drafts and archived records."
            ),
        })

    using = content._state.db or router.db_for_write(type(content), instance=content)
    model = type(content)
    with transaction.atomic(using=using):
        locked = (
            model.objects.using(using)
            .select_for_update()
            .filter(pk=content.pk)
            .first()
        )
        if locked is None:
            # Bulk delete may remove a working draft while deleting its live
            # parent; a later request for the same id is already done.
            return
        if locked.status not in REMOVABLE_STATUSES:
            raise ValidationError({
                "status": (
                    "Archive the content before permanently deleting it, or "
                    "delete only drafts and archived records."
                ),
            })
        for draft in _working_drafts(locked, using=using):
            hard_delete_content(draft)
        _assert_no_child_pages(locked, using=using)
        with hierarchy_write(using=using):
            with content_revision_delete(using=using):
                # Media usage rows PROTECT publication snapshots and revisions;
                # detach them before clearing append-only history.
                from apps.media.services import detach_references_for_content

                detach_references_for_content(
                    locked,
                    actor=locked.updated_by or locked.created_by,
                    using=using,
                )
                _detach_menu_items(locked, using=using)
                _purge_publication_history(locked, using=using)
                locked.delete(using=using)


def _working_drafts(content, *, using):
    related = getattr(type(content), "working_drafts", None)
    if related is None:
        return []
    return list(
        type(content).objects.using(using)
        .filter(draft_of_id=content.pk)
        .order_by("created_at", "pk")
    )


def _assert_no_child_pages(content, *, using):
    if not isinstance(content, Page):
        return
    child = (
        Page.objects.using(using)
        .filter(parent_id=content.pk)
        .values_list("pk", flat=True)
        .first()
    )
    if child is not None:
        raise ProtectedError(
            "This Page still has child Pages and cannot be deleted.",
            {Page: [child]},
        )


def _detach_menu_items(content, *, using):
    """Remove menu items that PROTECT this Page/Post so hard delete can proceed."""
    try:
        from apps.cms.menu_models import MenuItem
    except ImportError:
        return

    menu_filter = Q()
    if isinstance(content, Page):
        menu_filter |= Q(page_id=content.pk)
    if content._meta.label_lower == "api.post":
        menu_filter |= Q(post_id=content.pk)
    if not menu_filter:
        return

    roots = list(
        MenuItem.objects.using(using)
        .filter(menu_filter)
        .values_list("pk", flat=True)
    )
    if not roots:
        return

    # Children PROTECT parents; delete deepest descendants first.
    pending = set(roots)
    ordered = []
    while pending:
        progressed = False
        for item_id in list(pending):
            child_ids = list(
                MenuItem.objects.using(using)
                .filter(parent_id=item_id)
                .values_list("pk", flat=True)
            )
            unresolved = [child for child in child_ids if child not in ordered]
            if unresolved:
                pending.update(unresolved)
                continue
            ordered.append(item_id)
            pending.remove(item_id)
            progressed = True
        if not progressed:
            # Cycle or unexpected tree — fall back to collector error.
            raise ProtectedError(
                "This record is still linked from a menu and cannot be deleted.",
                {MenuItem: list(
                    MenuItem.objects.using(using).filter(pk__in=pending)[:5]
                )},
            )

    for item_id in reversed(ordered):
        MenuItem.objects.using(using).filter(pk=item_id).delete()


def _purge_publication_history(content, *, using):
    """Remove PROTECT history so the content row can be deleted.

    Working-draft approvals are often referenced by the live Page/Post
    publication snapshot. Clear those provenance FKs (payload stays) before
    deleting this content's workflow rows and revisions.
    """
    revision_ids = list(
        ContentRevision.objects.using(using)
        .filter(content_id=content.pk)
        .values_list("pk", flat=True)
    )
    transition_ids = list(
        ContentWorkflowTransition.objects.using(using)
        .filter(content_id=content.pk)
        .values_list("pk", flat=True)
    )
    provenance = Q()
    if transition_ids:
        provenance |= Q(approval_id__in=transition_ids)
    if revision_ids:
        provenance |= Q(approved_revision_id__in=revision_ids)
    if provenance:
        # UPDATE is allowed only while cms.content_delete is on.
        PublishedContentSnapshot.objects.using(using).filter(provenance).update(
            approval_id=None,
            approved_revision_id=None,
        )

    PublishedContentSnapshot.objects.using(using).filter(
        content_id=content.pk,
    ).delete()
    ContentWorkflowTransition.objects.using(using).filter(
        content_id=content.pk,
    ).delete()
