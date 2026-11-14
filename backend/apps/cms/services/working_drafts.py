"""Open one working draft for a published Page without taking it offline."""
from uuid import uuid4

from apps.organizations.hierarchy_lock import hierarchy_write
from django.core.exceptions import ValidationError
from django.db import IntegrityError, router, transaction
from django.shortcuts import get_object_or_404

from ..models import ContentEditConflict, ContentRole, ContentStatus, Page, PublishedContentSnapshot


def draft_write(*,using="default"):
    """Shared CMS draft transaction/lock boundary for Pages and articles."""
    return hierarchy_write(using=using)


def content_etag(page):
    return f'"cms-content-{page.pk}-r{page.revision_number}"'


def save_visual_draft(*, site_id, page_id, actor, if_match, visual_layout, using=None):
    """Replace one complete visual tree and its revision inventory atomically.

    Lock ordering is the existing CMS hierarchy lock followed by the scoped Page.
    The optimistic check precedes validation, so stale input cannot replace or
    remove references. Page.save creates the revision and its inventory inside
    this transaction; any failure rolls all three back together.
    """
    from ..authorization import require_cms_grant
    from ..layout_contract import validate_layout, validate_layout_media
    from .pages import require_pages_module, require_visual_builder_module

    using = using or router.db_for_write(Page)
    require_cms_grant(actor, site_id, (ContentRole.AUTHOR,), using=using)
    with hierarchy_write(using=using):
        require_cms_grant(actor, site_id, (ContentRole.AUTHOR,), using=using)
        require_pages_module(site_id, using=using)
        require_visual_builder_module(site_id, using=using)
        page = get_object_or_404(Page.objects.using(using).select_for_update(), pk=page_id, site_id=site_id)
        if not if_match or if_match != content_etag(page):
            raise ContentEditConflict("Content changed. Retrieve the current Page.")
        if page.status not in {ContentStatus.DRAFT, ContentStatus.UNPUBLISHED}:
            raise ValidationError({"status": "Save an editable working draft; the published Page stays unchanged."})
        validated = validate_layout(visual_layout)
        validate_layout_media(validated, site_id=site_id)
        page.metadata = {**page.metadata, "visual_layout": validated}
        # This request explicitly replaces the complete body with a visual
        # tree. Keep the old flat body in immutable history/public snapshots,
        # not as inactive references that could later fail asset validation.
        page.blocks = []
        page.updated_by = actor
        page.save(using=using, update_fields={"metadata", "blocks", "updated_by"})
        return page


def open_working_draft(page, *, actor, using=None, if_match=None):
    """Return the open working draft, creating it from the serving snapshot.

    The published Page stays PUBLISHED. A second call returns the same
    non-archived draft. The caller has already checked the Page ETag.
    """
    using = using or router.db_for_write(Page)
    with hierarchy_write(using=using):
        live = (
            Page.objects.using(using)
            .select_for_update()
            .get(pk=page.pk)
        )
        if if_match is not None and if_match != content_etag(live):
            raise ContentEditConflict("Content changed. Retrieve the current Page.")
        if live.draft_of_id:
            raise ValidationError({
                "draft_of": "Open the working draft from the published Page.",
            })
        if live.status != ContentStatus.PUBLISHED:
            raise ValidationError({
                "status": "A working draft can only be opened for a published Page.",
            })
        existing = (
            Page.objects.using(using)
            .select_for_update()
            .filter(draft_of=live)
            .exclude(status=ContentStatus.ARCHIVED)
            .order_by("created_at", "id")
            .first()
        )
        if existing is not None:
            return existing, False
        payload = _serving_payload(live, using=using)
        draft = Page(
            site_id=live.site_id,
            locale=live.locale,
            title=payload["title"],
            slug=f"wip-{uuid4().hex[:12]}",
            parent=None,
            layout=payload["layout"],
            seo=payload["seo"],
            visibility=payload["visibility"],
            position=0,
            is_homepage=False,
            blocks=payload["blocks"],
            blocks_version=payload["blocks_version"],
            metadata=payload["metadata"],
            draft_of=live,
            created_by=actor,
            updated_by=actor,
        )
        try:
            draft.save(using=using)
        except IntegrityError as error:
            raise ValidationError({
                "slug": "The working draft route could not be reserved.",
            }) from error
        return draft, True


def _serving_payload(page, *, using):
    snapshot = (
        PublishedContentSnapshot.objects.using(using)
        .filter(content_id=page.pk)
        .order_by("-version")
        .first()
    )
    if snapshot is None:
        raise ValidationError({
            "status": "The published Page has no serving snapshot.",
        })
    payload = snapshot.payload
    return {
        "title": payload["title"],
        "blocks": payload.get("blocks", []),
        "blocks_version": payload.get("blocks_version", page.blocks_version),
        "metadata": payload.get("metadata") or {},
        "seo": payload.get("seo") or {},
        "layout": payload.get("layout") or "",
        "visibility": payload.get("visibility") or page.visibility,
    }
