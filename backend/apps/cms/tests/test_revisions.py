"""Content revision capture, restore, retention and concurrency contracts."""
import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from apps.cms.models import (
    ContentEditConflict,
    ContentRevision,
    ContentRole,
    ContentStatus,
    Page,
    PublishedContentSnapshot,
    SiteContent,
    SiteContentRoleAssignment,
)
from apps.cms.services.pages import create_page
from apps.cms.services.revisions import (
    MAX_RETAINED_DRAFT_REVISIONS,
    restore_content_revision,
)
from apps.cms.services.workflow import transition_content

pytestmark = pytest.mark.django_db


def test_meaningful_saves_store_complete_immutable_revision_snapshots(sites):
    site, _ = sites
    editor = get_user_model().objects.create_user(username="revision-editor")
    page = create_page(
        site=site, title="Original", slug="original", actor=editor,
    )
    initial = page.revisions.get(revision_number=1)
    assert initial.editor_identity == str(editor.pk)
    assert initial.status == ContentStatus.DRAFT
    assert initial.snapshot["title"] == "Original"
    assert initial.snapshot["path"] == "/original"
    assert "title" in initial.changed_fields

    page.title = "Updated"
    page.updated_by = editor
    page.save()
    latest = page.revisions.get(revision_number=2)
    assert latest.snapshot["title"] == "Updated"
    assert latest.changed_fields == ["title"]

    initial.snapshot = {"tampered": True}
    with pytest.raises(ValidationError, match="immutable"):
        initial.save()
    with pytest.raises(IntegrityError), transaction.atomic():
        ContentRevision.objects.filter(pk=initial.pk).update(
            snapshot={"tampered": True},
        )
    with pytest.raises(IntegrityError), transaction.atomic():
        ContentRevision.objects.filter(pk=initial.pk).delete()


def test_stale_model_save_raises_conflict_without_overwriting_newer_content(sites):
    site, _ = sites
    page = create_page(site=site, title="First", slug="first")
    first = Page.objects.get(pk=page.pk)
    stale = Page.objects.get(pk=page.pk)

    first.title = "Saved first"
    first.save()
    stale.title = "Stale overwrite"
    with pytest.raises(ContentEditConflict):
        stale.save()

    page.refresh_from_db()
    assert page.title == "Saved first"
    assert page.revision_number == 2
    assert page.revisions.count() == 2


def test_snapshots_have_a_hard_size_limit_and_reject_oversized_saves(sites):
    site, _ = sites
    content = SiteContent.objects.create(site=site)
    original_revision = content.revision_number
    content.metadata = {"payload": "x" * (1024 * 1024)}
    with pytest.raises(ValidationError, match="must not exceed"):
        content.save()
    content.refresh_from_db()
    assert content.revision_number == original_revision
    assert content.metadata == {}


def test_draft_retention_keeps_recent_versions_but_not_unbounded_history(sites):
    site, _ = sites
    content = SiteContent.objects.create(site=site)
    for version in range(1, MAX_RETAINED_DRAFT_REVISIONS + 5):
        content.metadata = {"version": version}
        content.save()

    revisions = content.revisions.order_by("revision_number")
    assert revisions.count() == MAX_RETAINED_DRAFT_REVISIONS
    assert revisions.first().revision_number == 6
    assert revisions.last().revision_number == MAX_RETAINED_DRAFT_REVISIONS + 5


def test_restore_creates_a_new_draft_revision_and_preserves_source_history(sites):
    site, _ = sites
    editor = get_user_model().objects.create_user(username="restore-author")
    SiteContentRoleAssignment.objects.create(
        site=site, user=editor, role=ContentRole.AUTHOR,
    )
    page = create_page(
        site=site, title="Original", slug="original", actor=editor,
    )
    source = page.revisions.get(revision_number=1)
    page.title = "Newer title"
    page.updated_by = editor
    page.save()

    restored, restored_from = restore_content_revision(
        page.pk,
        source.revision_number,
        actor=editor,
        expected_revision=page.revision_number,
    )

    page.refresh_from_db()
    restored_revision = page.revisions.get(
        revision_number=page.revision_number,
    )
    source.refresh_from_db()
    assert restored.status == ContentStatus.DRAFT
    assert page.status == ContentStatus.DRAFT
    assert page.title == "Original"
    assert page.revision_number == 3
    assert restored_from.pk == source.pk
    assert restored_revision.restored_from_revision == source.revision_number
    assert source.snapshot["title"] == "Original"


def test_unpublished_restore_keeps_published_revisions_immutable(sites):
    site, _ = sites
    author = get_user_model().objects.create_user(username="publish-author")
    reviewer = get_user_model().objects.create_user(username="publish-reviewer")
    publisher = get_user_model().objects.create_user(username="publish-publisher")
    for user, role in (
        (author, ContentRole.AUTHOR),
        (reviewer, ContentRole.REVIEWER),
        (publisher, ContentRole.PUBLISHER),
    ):
        SiteContentRoleAssignment.objects.create(
            site=site, user=user, role=role,
        )
    page = create_page(
        site=site, title="Published title", slug="published", actor=author,
    )
    source = page.revisions.get(revision_number=1)
    transition_content(page.pk, action="submit", actor=author)
    transition_content(page.pk, action="approve", actor=reviewer)
    transition_content(page.pk, action="publish", actor=publisher)
    published_revision = page.revisions.get(status=ContentStatus.PUBLISHED)
    published_snapshot = page.publication_snapshots.get()
    with pytest.raises(IntegrityError), transaction.atomic():
        page.delete()
    transition_content(page.pk, action="unpublish", actor=publisher)
    page.refresh_from_db()
    restored, _ = restore_content_revision(
        page.pk,
        source.revision_number,
        actor=author,
        expected_revision=page.revision_number,
    )
    assert restored.status == ContentStatus.DRAFT

    for version in range(MAX_RETAINED_DRAFT_REVISIONS + 2):
        page = Page.objects.get(pk=page.pk)
        page.title = f"Draft {version}"
        page.updated_by = author
        page.save()

    published_revision.refresh_from_db()
    published_snapshot.refresh_from_db()
    assert page.revisions.filter(status=ContentStatus.PUBLISHED).count() == 1
    assert published_revision.snapshot["title"] == "Published title"
    assert published_snapshot.payload["title"] == "Published title"
