"""Permanent delete of draft and archived SiteContent, including history."""
from apps.cms.tests.support import grant_cms_role
import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError

from apps.api.models import Post
from apps.cms.models import (
    ContentRole,
    ContentStatus,
    ContentWorkflowTransition,
    Page,
    PublishedContentSnapshot,
)
from apps.cms.services.content_delete import hard_delete_content
from apps.cms.services.pages import create_page
from apps.cms.services.workflow import transition_content


pytestmark = pytest.mark.django_db


def _user(name):
    return get_user_model().objects.create_user(username=name)


def _grant(site, user, *roles):
    for role in roles:
        grant_cms_role(site=site, user=user, role=role)


def _publish_page(site, slug="admissions"):
    author, reviewer, publisher = (
        _user(f"{slug}-author"),
        _user(f"{slug}-reviewer"),
        _user(f"{slug}-publisher"),
    )
    _grant(site, author, ContentRole.AUTHOR)
    _grant(site, reviewer, ContentRole.REVIEWER)
    _grant(site, publisher, ContentRole.PUBLISHER)
    page = create_page(
        site=site,
        title=slug.replace("-", " ").title(),
        slug=slug,
        blocks=[{"type": "paragraph", "html": f"<p>{slug}</p>"}],
        actor=author,
    )
    transition_content(page.pk, action="submit", actor=author)
    transition_content(page.pk, action="approve", actor=reviewer)
    transition_content(page.pk, action="publish", actor=publisher)
    page.refresh_from_db()
    return page, publisher


def test_draft_page_hard_delete_removes_the_row(sites):
    site, _ = sites
    author = _user("draft-delete-author")
    _grant(site, author, ContentRole.AUTHOR)
    page = create_page(
        site=site, title="Scratch", slug="scratch",
        blocks=[{"type": "paragraph", "html": "<p>x</p>"}],
        actor=author,
    )
    pk = page.pk
    hard_delete_content(page)
    assert not Page.objects.filter(pk=pk).exists()


def test_published_page_cannot_be_hard_deleted(sites):
    site, _ = sites
    page, _ = _publish_page(site, "live-locked")
    with pytest.raises(ValidationError):
        hard_delete_content(page)
    assert Page.objects.filter(pk=page.pk).exists()
    assert PublishedContentSnapshot.objects.filter(content_id=page.pk).exists()


def test_archived_page_hard_delete_clears_history(sites):
    site, _ = sites
    page, publisher = _publish_page(site, "archive-purge")
    transition_content(page.pk, action="archive", actor=publisher)
    page.refresh_from_db()
    assert page.status == ContentStatus.ARCHIVED
    assert PublishedContentSnapshot.objects.filter(content_id=page.pk).exists()
    assert ContentWorkflowTransition.objects.filter(content_id=page.pk).exists()

    pk = page.pk
    hard_delete_content(page)

    assert not Page.objects.filter(pk=pk).exists()
    assert not PublishedContentSnapshot.objects.filter(content_id=pk).exists()
    assert not ContentWorkflowTransition.objects.filter(content_id=pk).exists()


def test_unpublished_page_hard_delete_clears_history(sites):
    site, _ = sites
    page, publisher = _publish_page(site, "unpub-purge")
    transition_content(page.pk, action="unpublish", actor=publisher)
    page.refresh_from_db()
    assert page.status == ContentStatus.UNPUBLISHED

    pk = page.pk
    hard_delete_content(page)
    assert not Page.objects.filter(pk=pk).exists()
    assert not PublishedContentSnapshot.objects.filter(content_id=pk).exists()


def test_archived_working_draft_delete_releases_live_snapshot_provenance(sites):
    site, _ = sites
    page, publisher = _publish_page(site, "draft-provenance")
    author = page.created_by
    _grant(site, author, ContentRole.AUTHOR)
    from apps.cms.services.working_drafts import open_working_draft

    draft, _created = open_working_draft(page, actor=author)
    draft.blocks = [{"type": "paragraph", "html": "<p>Revised</p>"}]
    draft.updated_by = author
    draft.save()
    reviewer = _user("draft-provenance-reviewer-2")
    _grant(site, reviewer, ContentRole.REVIEWER)
    transition_content(draft.pk, action="submit", actor=author)
    transition_content(draft.pk, action="approve", actor=reviewer)
    transition_content(draft.pk, action="publish", actor=publisher)
    draft.refresh_from_db()
    page.refresh_from_db()
    assert draft.status == ContentStatus.ARCHIVED
    assert page.status == ContentStatus.PUBLISHED
    snap = (
        PublishedContentSnapshot.objects
        .filter(content_id=page.pk)
        .order_by("-version")
        .first()
    )
    assert snap.approval_id is not None
    assert snap.approval.content_id == draft.pk

    draft_pk = draft.pk
    hard_delete_content(draft)

    assert not Page.objects.filter(pk=draft_pk).exists()
    page.refresh_from_db()
    assert page.status == ContentStatus.PUBLISHED
    snap = PublishedContentSnapshot.objects.get(pk=snap.pk)
    assert snap.approval_id is None
    assert snap.approved_revision_id is None
    assert snap.payload["blocks"]


def test_archived_post_hard_delete_clears_history(sites):

    site, _ = sites
    author, reviewer, publisher = (
        _user("post-purge-author"),
        _user("post-purge-reviewer"),
        _user("post-purge-publisher"),
    )
    _grant(site, author, ContentRole.AUTHOR)
    _grant(site, reviewer, ContentRole.REVIEWER)
    _grant(site, publisher, ContentRole.PUBLISHER)
    post = Post(
        site=site,
        title="Campus note",
        slug="campus-note",
        content="<p>Hello</p>",
        created_by=author,
        updated_by=author,
    )
    post.save()
    transition_content(post.pk, action="submit", actor=author)
    transition_content(post.pk, action="approve", actor=reviewer)
    transition_content(post.pk, action="publish", actor=publisher)
    transition_content(post.pk, action="archive", actor=publisher)
    post.refresh_from_db()
    assert post.status == ContentStatus.ARCHIVED
    assert PublishedContentSnapshot.objects.filter(content_id=post.pk).exists()

    pk = post.pk
    hard_delete_content(post)
    assert not Post.objects.filter(pk=pk).exists()
    assert not PublishedContentSnapshot.objects.filter(content_id=pk).exists()
    assert not ContentWorkflowTransition.objects.filter(content_id=pk).exists()
