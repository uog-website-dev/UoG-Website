"""Site-scoped CMS state machine, authorization, audit and publication tests."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError, close_old_connections, connections, transaction

from apps.audit.models import AuditEvent
from apps.cms.models import (
    ContentRole,
    ContentStatus,
    ContentWorkflowTransition,
    Page,
    PublishedContentSnapshot,
    SiteContent,
    SiteContentRoleAssignment,
)
from apps.cms.services.pages import create_page
from apps.cms.services.workflow import transition_content


pytestmark = pytest.mark.django_db


def _user(name):
    return get_user_model().objects.create_user(username=name)


def _grant(site, user, *roles):
    SiteContentRoleAssignment.objects.bulk_create([
        SiteContentRoleAssignment(site=site, user=user, role=role)
        for role in roles
    ])


def _page(site, actor):
    return create_page(
        site=site,
        title="Admissions",
        slug="admissions",
        blocks=[{
            "type": "paragraph",
            "html": "<p>Applications are open.</p>",
        }],
        actor=actor,
    )


def _transition(content, action, actor, *, roles=(), comment=""):
    return transition_content(
        content.pk, action=action, actor=actor, roles=roles, comment=comment,
    )


def test_state_machine_permissions_snapshot_and_publish_idempotency(sites):
    site, _ = sites
    author, reviewer, publisher = (
        _user("workflow-author"),
        _user("workflow-reviewer"),
        _user("workflow-publisher"),
    )
    _grant(site, author, ContentRole.AUTHOR)
    _grant(site, reviewer, ContentRole.REVIEWER)
    _grant(site, publisher, ContentRole.PUBLISHER)
    page = _page(site, author)

    with pytest.raises(PermissionDenied):
        _transition(page, "submit", reviewer)
    with pytest.raises(ValidationError):
        _transition(page, "approve", reviewer)

    _transition(page, "submit", author)
    page.refresh_from_db()
    assert page.status == ContentStatus.IN_REVIEW
    with pytest.raises(PermissionDenied):
        _transition(page, "approve", author)
    with pytest.raises(PermissionDenied):
        _transition(page, "publish", reviewer)

    _transition(page, "approve", reviewer, comment="Approved for release.")
    page.refresh_from_db()
    assert page.status == ContentStatus.APPROVED
    with pytest.raises(ValidationError):
        _transition(page, "approve", reviewer)

    published = _transition(page, "publish", publisher)
    published.refresh_from_db()
    assert published.status == ContentStatus.PUBLISHED
    assert published.published_at is not None
    snapshot = PublishedContentSnapshot.objects.get(content=page, version=1)
    assert snapshot.payload["status"] == ContentStatus.PUBLISHED
    assert snapshot.payload["site_id"] == site.pk
    assert snapshot.payload["title"] == "Admissions"
    assert snapshot.payload["blocks"] == page.blocks

    _transition(page, "publish", publisher)
    assert PublishedContentSnapshot.objects.filter(content=page).count() == 1
    assert ContentWorkflowTransition.objects.filter(content=page).count() == 3
    assert AuditEvent.objects.filter(
        entity_type="cms.sitecontent", entity_id=str(page.pk),
    ).count() == 3
    assert list(
        AuditEvent.objects.filter(entity_id=str(page.pk))
        .order_by("timestamp")
        .values_list("action", flat=True)
    ) == ["CONTENT_SUBMITTED", "CONTENT_APPROVED", "CONTENT_PUBLISHED"]
    submitted_audit = AuditEvent.objects.get(
        entity_id=str(page.pk), action="CONTENT_SUBMITTED",
    )
    assert submitted_audit.actor_kind == "USER"
    assert submitted_audit.actor_id == str(author.pk)
    assert submitted_audit.after["site_id"] == site.pk

    page.refresh_from_db()
    page.title = "Silent live edit"
    with pytest.raises(ValidationError):
        page.save()
    with pytest.raises(IntegrityError), transaction.atomic():
        Page.objects.filter(pk=page.pk).update(title="Raw live edit")
    with pytest.raises(IntegrityError), transaction.atomic():
        SiteContent.objects.filter(pk=page.pk).update(blocks=[])
    assert PublishedContentSnapshot.objects.get(pk=snapshot.pk).payload["title"] == "Admissions"

    _transition(page, "unpublish", publisher)
    page.refresh_from_db()
    assert page.status == ContentStatus.UNPUBLISHED
    first_published_at = page.published_at
    page.title = "Updated admissions"
    page.save()
    _transition(page, "restore", author)
    _transition(page, "submit", author)
    _transition(page, "approve", reviewer)
    _transition(page, "publish", publisher)
    assert PublishedContentSnapshot.objects.filter(content=page).count() == 2
    latest = PublishedContentSnapshot.objects.get(content=page, version=2)
    assert latest.payload["title"] == "Updated admissions"
    page.refresh_from_db()
    assert page.published_at == first_published_at


def test_rejection_returns_editable_draft_and_keeps_reviewer_comment(sites):
    site, _ = sites
    author, reviewer = _user("reject-author"), _user("reject-reviewer")
    _grant(site, author, ContentRole.AUTHOR)
    _grant(site, reviewer, ContentRole.REVIEWER)
    page = _page(site, author)
    _transition(page, "submit", author)
    with pytest.raises(ValidationError) as error:
        _transition(page, "reject", reviewer)
    assert "comment" in error.value.message_dict

    _transition(page, "reject", reviewer, comment="Please correct the dates.")
    page.refresh_from_db()
    assert page.status == ContentStatus.DRAFT
    assert page.review_comment == "Please correct the dates."
    assert page.reviewed_by_id == reviewer.pk
    history = ContentWorkflowTransition.objects.get(content=page, to_status="DRAFT")
    assert history.comment == "Please correct the dates."
    audited = AuditEvent.objects.get(
        entity_id=str(page.pk), action="CONTENT_REJECTED",
    )
    assert audited.after["review_comment"] == "Please correct the dates."

    page.title = "Corrected dates"
    page.save()
    assert Page.objects.get(pk=page.pk).title == "Corrected dates"
    _transition(page, "submit", author)
    page.refresh_from_db()
    assert page.review_comment == ""


def test_site_roles_are_scoped_and_platform_role_is_explicit(sites):
    site, other_site = sites
    actor = _user("scoped-author")
    _grant(site, actor, ContentRole.AUTHOR)
    own_page = _page(site, actor)
    foreign_page = _page(other_site, actor)

    _transition(own_page, "submit", actor)
    with pytest.raises(PermissionDenied):
        _transition(foreign_page, "submit", actor)

    admin = _user("workflow-platform-admin")
    admin.is_staff = True
    admin.save(update_fields=("is_staff",))
    with pytest.raises(PermissionDenied):
        _transition(foreign_page, "submit", admin)
    _transition(foreign_page, "submit", admin, roles={"platform-admin"})
    assert SiteContent.objects.get(pk=foreign_page.pk).status == ContentStatus.IN_REVIEW


@pytest.mark.parametrize(
    "action",
    ["approve", "reject", "publish", "unpublish", "archive", "restore"],
)
def test_invalid_transitions_from_draft_are_rejected(sites, action):
    site, _ = sites
    author, reviewer, publisher = (
        _user(f"matrix-author-{action}"),
        _user(f"matrix-reviewer-{action}"),
        _user(f"matrix-publisher-{action}"),
    )
    _grant(site, author, ContentRole.AUTHOR)
    _grant(site, reviewer, ContentRole.REVIEWER)
    _grant(site, publisher, ContentRole.PUBLISHER)
    page = _page(site, author)
    actor = {
        "approve": reviewer,
        "reject": reviewer,
        "publish": publisher,
        "unpublish": publisher,
        "archive": publisher,
        "restore": author,
    }[action]
    with pytest.raises(ValidationError):
        _transition(page, action, actor, comment="required for reject")
    assert SiteContent.objects.get(pk=page.pk).status == ContentStatus.DRAFT


def test_audit_failure_rolls_back_status_history_and_snapshot(sites, monkeypatch):
    site, _ = sites
    author, reviewer, publisher = (
        _user("rollback-author"),
        _user("rollback-reviewer"),
        _user("rollback-publisher"),
    )
    _grant(site, author, ContentRole.AUTHOR)
    _grant(site, reviewer, ContentRole.REVIEWER)
    _grant(site, publisher, ContentRole.PUBLISHER)
    page = _page(site, author)
    _transition(page, "submit", author)
    _transition(page, "approve", reviewer)

    from apps.cms.services import workflow

    def fail_snapshot(*args, **kwargs):
        raise RuntimeError("snapshot store unavailable")

    monkeypatch.setattr(workflow, "_create_publication_snapshot", fail_snapshot)
    with pytest.raises(RuntimeError, match="snapshot store unavailable"):
        _transition(page, "publish", publisher)
    page.refresh_from_db()
    assert page.status == ContentStatus.APPROVED
    assert not PublishedContentSnapshot.objects.filter(content=page).exists()
    assert not ContentWorkflowTransition.objects.filter(
        content=page, to_status=ContentStatus.PUBLISHED,
    ).exists()
    assert not AuditEvent.objects.filter(
        entity_id=str(page.pk), action="CONTENT_PUBLISHED",
    ).exists()


@pytest.mark.parametrize(
    "archive_from",
    [ContentStatus.APPROVED, ContentStatus.PUBLISHED, ContentStatus.UNPUBLISHED],
)
def test_approved_published_and_unpublished_content_can_be_archived(sites, archive_from):
    site, _ = sites
    author, reviewer, publisher = (
        _user(f"archive-author-{archive_from}"),
        _user(f"archive-reviewer-{archive_from}"),
        _user(f"archive-publisher-{archive_from}"),
    )
    _grant(site, author, ContentRole.AUTHOR)
    _grant(site, reviewer, ContentRole.REVIEWER)
    _grant(site, publisher, ContentRole.PUBLISHER)
    page = _page(site, author)
    _transition(page, "submit", author)
    _transition(page, "approve", reviewer)
    if archive_from in {ContentStatus.PUBLISHED, ContentStatus.UNPUBLISHED}:
        _transition(page, "publish", publisher)
    if archive_from == ContentStatus.UNPUBLISHED:
        _transition(page, "unpublish", publisher)
    assert SiteContent.objects.get(pk=page.pk).status == archive_from

    _transition(page, "archive", publisher)
    page.refresh_from_db()
    assert page.status == ContentStatus.ARCHIVED
    with pytest.raises(ValidationError):
        _transition(page, "restore", author)


@pytest.mark.django_db(transaction=True)
def test_concurrent_publish_retries_create_one_snapshot_and_audit(sites):
    site, _ = sites
    author, reviewer, publisher = (
        _user("concurrent-author"),
        _user("concurrent-reviewer"),
        _user("concurrent-publisher"),
    )
    _grant(site, author, ContentRole.AUTHOR)
    _grant(site, reviewer, ContentRole.REVIEWER)
    _grant(site, publisher, ContentRole.PUBLISHER)
    page = _page(site, author)
    _transition(page, "submit", author)
    _transition(page, "approve", reviewer)
    barrier = Barrier(2)

    def publish():
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            return transition_content(
                page.pk, action="publish", actor=publisher,
            ).status
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _: publish(), range(2)))

    assert outcomes == [ContentStatus.PUBLISHED, ContentStatus.PUBLISHED]
    assert PublishedContentSnapshot.objects.filter(content=page).count() == 1
    assert ContentWorkflowTransition.objects.filter(
        content=page, to_status=ContentStatus.PUBLISHED,
    ).count() == 1
    assert AuditEvent.objects.filter(
        entity_id=str(page.pk), action="CONTENT_PUBLISHED",
    ).count() == 1
