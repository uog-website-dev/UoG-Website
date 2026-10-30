"""Immutable content history, optimistic concurrency and safe restoration."""
import hashlib
import json
from contextlib import contextmanager

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import connections, router, transaction

from apps.audit.context import (
    audit_context, current_audit_context,
)
from apps.audit.writer import record_event

from ..models import (
    ContentRevision,
    ContentEditConflict,
    ContentRole,
    ContentStatus,
    Page,
    SiteContent,
    SiteContentRoleAssignment,
    revision_origin,
)
from .pages import change_route, set_as_homepage
from .workflow import transition_content

MAX_REVISION_SNAPSHOT_BYTES = 1_048_576
MAX_RETAINED_DRAFT_REVISIONS = 100


def revision_snapshot(content):
    """Return a stable JSON snapshot of the complete content record."""
    snapshot = {
        "content_id": str(content.pk),
        "content_type": content._meta.label_lower,
        "site_id": content.site_id,
        "status": content.status,
        "locale": content.locale,
        "published_at": (
            content.published_at.isoformat()
            if content.published_at is not None else None
        ),
        "review_comment": content.review_comment,
        "blocks": content.blocks,
        "blocks_version": content.blocks_version,
        "metadata": content.metadata,
    }
    if isinstance(content, Page):
        snapshot.update({
            "parent_id": (
                str(content.parent_id) if content.parent_id is not None else None
            ),
            "title": content.title,
            "slug": content.slug,
            "path": content.path,
            "layout": content.layout,
            "seo": content.seo,
            "visibility": content.visibility,
            "position": content.position,
            "is_homepage": content.is_homepage,
        })
    return snapshot


def snapshot_size(snapshot):
    encoded = json.dumps(
        snapshot, sort_keys=True, separators=(", ", ": "), ensure_ascii=False,
    ).encode("utf-8")
    return len(encoded)


@contextmanager
def content_revision_write(*, using):
    with _database_flag(using, "cms.content_revision_write"):
        yield


@contextmanager
def content_revision_delete(*, using):
    with _database_flag(using, "cms.content_delete"):
        yield


@contextmanager
def _database_flag(using, setting):
    with transaction.atomic(using=using):
        with connections[using].cursor() as cursor:
            cursor.execute("SELECT current_setting(%s, true)", [setting])
            previous = cursor.fetchone()[0] or ""
            cursor.execute(
                "SELECT set_config(%s, 'on', true)", [setting],
            )
        yield
        with connections[using].cursor() as cursor:
            cursor.execute(
                "SELECT set_config(%s, %s, true)",
                [setting, previous],
            )


def create_content_revision(
    content, *, snapshot, changed_fields, using, restored_from=None,
):
    editor_id = content.updated_by_id or content.created_by_id
    editor_identity = str(editor_id) if editor_id is not None else "system"
    digest = hashlib.sha256(
        json.dumps(
            snapshot, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        ).encode("utf-8"),
    ).hexdigest()
    with content_revision_write(using=using):
        revision = ContentRevision.objects.using(using).create(
            content_id=content.pk,
            site_id=content.site_id,
            revision_number=content.revision_number,
            editor_identity=editor_identity,
            status=content.status,
            snapshot=snapshot,
            changed_fields=changed_fields,
            content_hash=digest,
            restored_from_revision=(
                restored_from.revision_number
                if restored_from is not None else None
            ),
        )
    _prune_revisions(content.pk, using=using)
    return revision


def _prune_revisions(content_id, *, using):
    restored_revisions = (
        ContentRevision.objects.using(using)
        .filter(content_id=content_id)
        .exclude(restored_from_revision__isnull=True)
        .values_list("restored_from_revision", flat=True)
    )
    candidates = (
        ContentRevision.objects.using(using)
        .filter(content_id=content_id)
        .exclude(status=ContentStatus.PUBLISHED)
        .exclude(revision_number__in=restored_revisions)
        .order_by("-revision_number")
        .values_list("pk", flat=True)[MAX_RETAINED_DRAFT_REVISIONS:]
    )
    obsolete_ids = list(candidates)
    if not obsolete_ids:
        return
    with _database_flag(using, "cms.revision_retention"):
        ContentRevision.objects.using(using).filter(
            pk__in=obsolete_ids,
        ).delete()


def authorize_revision_access(actor, *, site_id, roles=(), using=None):
    using = using or router.db_for_read(SiteContent)
    _authorize(
        actor, site_id=site_id, roles=roles,
        required_roles=ContentRole.values, using=using,
    )


def restore_content_revision(
    content_id, revision_number, *, actor, roles=(),
    expected_revision=None, using=None,
):
    """Restore a historic payload as a new DRAFT revision, never live."""
    if not getattr(actor, "is_authenticated", False):
        raise PermissionDenied("An authenticated user is required.")
    using = using or router.db_for_write(SiteContent)
    with transaction.atomic(using=using):
        content = (
            SiteContent.objects.using(using)
            .select_for_update()
            .get(pk=content_id)
        )
        if (
            expected_revision is not None
            and content.revision_number != expected_revision
        ):
            raise ContentEditConflict(
                "Content changed after the revision list was retrieved."
            )
        _authorize(
            actor,
            site_id=content.site_id,
            roles=roles,
            required_roles=(ContentRole.AUTHOR,),
            using=using,
        )
        source = ContentRevision.objects.using(using).filter(
            site_id=content.site_id,
            content_id=content.pk,
            revision_number=revision_number,
        ).first()
        if source is None:
            raise ContentRevision.DoesNotExist
        content = _content_instance(content.pk, using=using)
        if content.status not in {
            ContentStatus.DRAFT, ContentStatus.UNPUBLISHED,
        }:
            raise ValidationError({
                "status": (
                    "Restore is allowed only for draft or unpublished "
                    "content. Move reviewed or published content through "
                    "the workflow first."
                ),
            })

        before = revision_snapshot(content)
        before_revision_number = content.revision_number
        if content.status == ContentStatus.UNPUBLISHED:
            transition_content(
                content.pk,
                action="restore",
                actor=actor,
                roles=roles,
                using=using,
            )
            content = _content_instance(content.pk, using=using)

        payload = source.snapshot
        is_page = isinstance(content, Page)
        if is_page:
            parent_id = payload.get("parent_id")
            parent = (
                Page.objects.using(using).filter(pk=parent_id).first()
                if parent_id is not None else None
            )
            if parent_id is not None and parent is None:
                raise ValidationError({
                    "parent": "The historical parent page no longer exists.",
                })
            if (
                content.slug != payload.get("slug")
                or content.parent_id != parent_id
            ):
                change_route(
                    content,
                    slug=payload.get("slug", content.slug),
                    parent=parent,
                    actor=actor,
                )
            content.title = payload.get("title", content.title)
            content.layout = payload.get("layout", content.layout)
            content.seo = payload.get("seo", content.seo)
            content.visibility = payload.get("visibility", content.visibility)
            content.position = payload.get("position", content.position)
            restore_homepage = bool(payload.get("is_homepage", False))
            has_other_homepage = Page.objects.using(using).filter(
                site_id=content.site_id, is_homepage=True,
            ).exclude(pk=content.pk).exists()
            content.is_homepage = restore_homepage and not has_other_homepage
        else:
            content.locale = payload.get("locale", content.locale)
            restore_homepage = False

        content.metadata = payload["metadata"]
        content.blocks = payload["blocks"]
        content.blocks_version = payload["blocks_version"]
        content.updated_by = actor
        with revision_origin(source):
            content.save(using=using)
        if restore_homepage and not content.is_homepage:
            content = set_as_homepage(content, actor=actor)

        audit_context_before = current_audit_context()
        with audit_context(
            actor_kind="USER",
            actor_id=str(actor.pk),
            request_id=audit_context_before.request_id,
            ip=audit_context_before.ip,
        ):
            record_event(
                action="CONTENT_REVISION_RESTORED",
                entity_type="cms.sitecontent",
                entity_id=content.pk,
                before={
                    "site_id": content.site_id,
                    "revision_number": before_revision_number,
                    "status": before["status"],
                },
                after={
                    "site_id": content.site_id,
                    "revision_number": content.revision_number,
                    "restored_from_revision": source.revision_number,
                    "status": content.status,
                },
                changed_fields=(
                    "revision_number", "restored_from_revision", "status",
                ),
                using=using,
            )
        return content, source


def _content_instance(content_id, *, using):
    page = Page.objects.using(using).filter(pk=content_id).first()
    if page is not None:
        return page
    return SiteContent.objects.using(using).get(pk=content_id)


def _authorize(actor, *, site_id, roles, required_roles, using):
    if not getattr(actor, "is_authenticated", False):
        raise PermissionDenied("An authenticated user is required.")
    if "platform-admin" in set(roles or ()):
        return
    if SiteContentRoleAssignment.objects.using(using).filter(
        site_id=site_id,
        user_id=actor.pk,
        role__in=required_roles,
        user__is_active=True,
    ).exists():
        return
    raise PermissionDenied("A CMS role assigned to this Site is required.")
