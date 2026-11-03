"""Open one working draft for a published Page without taking it offline."""
from uuid import uuid4

from django.core.exceptions import ValidationError
from django.db import IntegrityError, router, transaction

from ..models import ContentStatus, Page, PublishedContentSnapshot


def open_working_draft(page, *, actor, using=None):
    """Return the open working draft, creating it from the serving snapshot.

    The published Page stays PUBLISHED. A second call returns the same
    non-archived draft. The caller has already checked the Page ETag.
    """
    using = using or router.db_for_write(Page)
    with transaction.atomic(using=using):
        live = (
            Page.objects.using(using)
            .select_for_update()
            .get(pk=page.pk)
        )
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
