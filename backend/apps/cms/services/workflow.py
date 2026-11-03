"""Authorized, transactional workflow transitions shared by CMS content."""
from contextlib import contextmanager

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import connections, router, transaction
from django.utils import timezone

from apps.audit.context import (
    audit_context, current_audit_context, database_audit_context,
)
from apps.audit.writer import record_event

from ..authorization import cms_grant_allows
from ..models import (
    ContentRole,
    ContentStatus,
    ContentWorkflowTransition,
    Page,
    PublishedContentSnapshot,
    SiteContent,
    apply_working_draft,
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

        publish_working_draft = (
            action == "publish"
            and isinstance(content, Page)
            and content.draft_of_id
        )
        if not publish_working_draft:
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
                    if publish_working_draft:
                        return _publish_working_draft(
                            content, actor=actor, comment=comment, using=using,
                        )
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
                    elif content._meta.model_name == "post" and (
                        action in {"publish", "unpublish"}
                        or (action == "archive" and source == ContentStatus.PUBLISHED)
                    ):
                        bump_publication_version(
                            content.site_id,
                            content.locale,
                            path=f"/posts/{content.slug}",
                            using=using,
                        )
                        from ..menu_cache import invalidate_post_delivery
                        invalidate_post_delivery(content.pk, using=using)
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


@contextmanager
def _apply_working_draft_database(*, using):
    with connections[using].cursor() as cursor:
        cursor.execute("SELECT current_setting('cms.apply_working_draft', true)")
        previous = cursor.fetchone()[0] or ""
        cursor.execute(
            "SELECT set_config('cms.apply_working_draft', 'on', true)"
        )
    try:
        yield
    finally:
        with connections[using].cursor() as cursor:
            cursor.execute(
                "SELECT set_config('cms.apply_working_draft', %s, true)",
                [previous],
            )


def _publish_working_draft(draft, *, actor, comment, using):
    """Copy an approved draft onto its published Page and archive the draft.

    The published row stays PUBLISHED. Its route and homepage flag stay.
    Callers hold the draft row lock and the workflow write settings.
    """
    try:
        target = (
            Page.objects.using(using)
            .select_for_update()
            .get(pk=draft.draft_of_id)
        )
    except Page.DoesNotExist as error:
        raise ValidationError({
            "draft_of": "The published Page does not exist.",
        }) from error
    if target.site_id != draft.site_id or target.locale != draft.locale:
        raise ValidationError({
            "draft_of": "A working draft must stay on the published Page's "
                        "Site and language.",
        })
    if target.status != ContentStatus.PUBLISHED:
        raise ValidationError({
            "status": "The live Page is no longer published, so this draft "
                      "cannot replace it.",
        })
    previous_title = target.title
    target.title = draft.title
    target.blocks = draft.blocks
    target.blocks_version = draft.blocks_version
    target.metadata = draft.metadata
    target.seo = draft.seo
    target.layout = draft.layout
    target.visibility = draft.visibility
    target.updated_by = actor
    target.updated_at = timezone.now()
    with apply_working_draft(), _apply_working_draft_database(using=using):
        target.save(using=using)
    _create_publication_snapshot(target, using=using)
    bump_publication_version(
        target.site_id, target.locale, path=target.path, using=using,
    )
    record_event(
        action="CONTENT_PUBLISHED",
        entity_type="cms.sitecontent",
        entity_id=str(target.pk),
        before={"title": previous_title},
        after={"title": target.title, "working_draft_id": str(draft.pk)},
        changed_fields=[
            "title", "blocks", "blocks_version", "metadata",
            "seo", "layout", "visibility",
        ],
        using=using,
    )
    draft.status = ContentStatus.ARCHIVED
    draft.updated_by = actor
    draft.updated_at = timezone.now()
    draft.save(using=using)
    ContentWorkflowTransition.objects.using(using).create(
        content=draft,
        from_status=ContentStatus.APPROVED,
        to_status=ContentStatus.ARCHIVED,
        actor=actor,
        comment=comment or f"Published onto page {target.pk}.",
    )
    return draft


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
    # ``roles`` is retained for callers that used to forward bearer claims.
    # Those claims are not an authorization source.
    del roles
    if cms_grant_allows(actor, site_id, (role,), using=using):
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
    from apps.api.models import Post
    post = Post.objects.using(using).filter(pk=base.pk).first()
    if post is not None:
        return post
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
    elif content._meta.model_name == "post":
        payload.update({
            "title": content.title,
            "slug": content.slug,
            "excerpt": content.excerpt,
            "content": content.content,
            "excerpt_html": content.excerpt_html,
            "author_id": content.author_id,
            "featured_media": content.featured_media,
            "seo": content.seo,
            "categories": [
                {
                    "id": str(row["id"]), "code": row["code"],
                    "name": row["name"], "slug": row["slug"],
                }
                for row in content.categories.order_by("name", "id").values(
                    "id", "code", "name", "slug",
                )
            ],
            "tags": [
                {
                    "id": str(row["id"]), "code": row["code"],
                    "name": row["name"], "slug": row["slug"],
                }
                for row in content.tags.order_by("name", "id").values(
                    "id", "code", "name", "slug",
                )
            ],
        })
    PublishedContentSnapshot.objects.using(using).create(
        content_id=content.pk,
        version=(latest or 0) + 1,
        payload=payload,
        published_at=timezone.now(),
    )
