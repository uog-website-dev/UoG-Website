"""Authorized, transactional workflow transitions shared by CMS content."""
from contextlib import contextmanager

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import connections, router, transaction
from django.utils import timezone

from apps.audit.context import (
    audit_context, current_audit_context, database_audit_context,
)

from ..models import (
    ContentRole,
    ContentStatus,
    ContentWorkflowTransition,
    Page,
    PublishedContentSnapshot,
    SiteContent,
    SiteContentRoleAssignment,
    workflow_write,
)
from .publication_cache import bump_publication_version

_ACTIONS = {
    "submit": (ContentStatus.DRAFT, ContentStatus.IN_REVIEW, ContentRole.AUTHOR),
    "approve": (
        ContentStatus.IN_REVIEW, ContentStatus.APPROVED, ContentRole.REVIEWER,
    ),
    "reject": (ContentStatus.IN_REVIEW, ContentStatus.DRAFT, ContentRole.REVIEWER),
    "publish": (
        ContentStatus.APPROVED, ContentStatus.PUBLISHED, ContentRole.PUBLISHER,
    ),
    "unpublish": (
        ContentStatus.PUBLISHED, ContentStatus.UNPUBLISHED, ContentRole.PUBLISHER,
    ),
    "archive": (
        ContentStatus.APPROVED, ContentStatus.ARCHIVED, ContentRole.PUBLISHER,
    ),
    "restore": (
        ContentStatus.UNPUBLISHED, ContentStatus.DRAFT, ContentRole.AUTHOR,
    ),
}

def transition_content(
    content_id, *, action, actor, roles=(), comment="", using=None,
):
    """Apply one authorized workflow action and return the locked content.

    The published state is idempotent: a retry of ``publish`` returns the
    existing row without creating another snapshot, transition or audit
    event. Concurrent retries serialize on the SiteContent row lock.
    """
    if action not in _ACTIONS:
        raise ValidationError({"action": "Unknown content workflow action."})
    if not getattr(actor, "is_authenticated", False):
        raise PermissionDenied("An authenticated user is required.")
    if not isinstance(comment, str):
        raise ValidationError({"comment": "Comment must be a string."})
    comment = comment.strip()
    if len(comment) > 5000:
        raise ValidationError({"comment": "Comment must be at most 5000 characters."})
    if action == "reject" and not comment:
        raise ValidationError({"comment": "A reviewer comment is required for rejection."})

    using = using or router.db_for_write(SiteContent)
    with transaction.atomic(using=using):
        base = (
            SiteContent.objects.using(using)
            .select_for_update()
            .get(pk=content_id)
        )
        content = _content_instance(base, using=using)
        required_role = _ACTIONS[action][2]
        _authorize(
            actor, site_id=content.site_id, role=required_role,
            roles=roles, using=using,
        )
        source, target, _ = _action_transition(action, content.status)

        if action == "publish" and content.status == ContentStatus.PUBLISHED:
            return content
        if content.status != source:
            raise ValidationError({
                "status": (
                    f"Cannot {action} content in {content.status}; "
                    f"expected {source}."
                ),
            })

        if action in {"approve", "reject"} and _is_author(actor, content):
            raise PermissionDenied(
                "The author and submitter cannot review their own content."
            )

        content.status = target
        content.updated_by = actor
        content.updated_at = timezone.now()
        if action == "submit":
            content.submitted_by = actor
            content.review_comment = ""
        elif action in {"approve", "reject"}:
            content.reviewed_by = actor
            content.review_comment = comment

        audit_context_before = current_audit_context()
        with audit_context(
            actor_kind="USER",
            actor_id=str(actor.pk),
            request_id=audit_context_before.request_id,
            ip=audit_context_before.ip,
        ):
            with database_audit_context(using=using):
                with _workflow_database_write(using=using), workflow_write():
                    content.save(using=using)
                    ContentWorkflowTransition.objects.using(using).create(
                        content=content,
                        from_status=source,
                        to_status=target,
                        actor=actor,
                        comment=comment,
                    )
                    if action == "publish":
                        _create_publication_snapshot(content, using=using)
                    if isinstance(content, Page) and (
                        action in {"publish", "unpublish"}
                        or (action == "archive" and source == ContentStatus.PUBLISHED)
                    ):
                        bump_publication_version(
                            content.site_id,
                            content.locale,
                            path=content.path,
                            using=using,
                        )
        return content


@contextmanager
def _workflow_database_write(*, using):
    with connections[using].cursor() as cursor:
        cursor.execute("SELECT current_setting('cms.workflow_transition', true)")
        previous = cursor.fetchone()[0] or ""
        cursor.execute(
            "SELECT set_config('cms.workflow_transition', 'on', true)"
        )
    try:
        yield
    finally:
        with connections[using].cursor() as cursor:
            cursor.execute(
                "SELECT set_config('cms.workflow_transition', %s, true)",
                [previous],
            )


def _action_transition(action, current_status):
    if action == "archive":
        if current_status not in {
            ContentStatus.APPROVED, ContentStatus.PUBLISHED,
            ContentStatus.UNPUBLISHED,
        }:
            raise ValidationError({
                "status": "Content may only be archived from an approved, "
                          "published or unpublished state.",
            })
        return current_status, ContentStatus.ARCHIVED, ContentRole.PUBLISHER
    return _ACTIONS[action]


def _authorize(actor, *, site_id, role, roles, using):
    if "platform-admin" in set(roles or ()):
        return
    if SiteContentRoleAssignment.objects.using(using).filter(
        site_id=site_id, user_id=actor.pk, role=role,
        user__is_active=True,
    ).exists():
        return
    raise PermissionDenied(
        f"The {role.label.lower()} role is required for this Site."
    )


def _is_author(actor, content):
    return actor.pk in {content.created_by_id, content.submitted_by_id}


def _content_instance(base, *, using):
    page = Page.objects.using(using).filter(pk=base.pk).first()
    if page is not None:
        return page
    return base


def _create_publication_snapshot(content, *, using):
    latest = (
        PublishedContentSnapshot.objects.using(using)
        .filter(content_id=content.pk)
        .order_by("-version")
        .values_list("version", flat=True)
        .first()
    )
    payload = {
        "content_id": str(content.pk),
        "content_type": content._meta.label_lower,
        "site_id": content.site_id,
        "status": ContentStatus.PUBLISHED,
        "locale": content.locale,
        "blocks": content.blocks,
        "blocks_version": content.blocks_version,
        "metadata": content.metadata,
    }
    if isinstance(content, Page):
        payload.update({
            "title": content.title,
            "slug": content.slug,
            "path": content.path,
            "layout": content.layout,
            "seo": content.seo,
            "visibility": content.visibility,
            "position": content.position,
            "is_homepage": content.is_homepage,
            "parent_id": content.parent_id,
        })
    PublishedContentSnapshot.objects.using(using).create(
        content_id=content.pk,
        version=(latest or 0) + 1,
        payload=payload,
        published_at=timezone.now(),
    )
