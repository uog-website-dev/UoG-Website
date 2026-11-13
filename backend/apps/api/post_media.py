"""Article image identities and immutable revision placement inventory."""
from uuid import UUID

from django.core.exceptions import ValidationError

from apps.media.models import MediaAsset, MediaAssetReference
from apps.media.selectors import READY_IMAGE_TYPES, authorize
from apps.media.services import _media_write_session
from .post_editor import article_images


def featured_asset_id(reference, site_id):
    prefix = f"sites/{site_id}/assets/"
    if not isinstance(reference, str) or not reference.startswith(prefix):
        raise ValidationError({"featured_media": "Choose an image from this Site's media library."})
    try:
        return str(UUID(reference[len(prefix):]))
    except (ValueError, AttributeError) as error:
        raise ValidationError({"featured_media": "Choose a valid media asset."}) from error


def image_uses(post):
    uses = []
    if post.featured_media:
        # Existing legacy references remain readable until replaced in the picker.
        if "/assets/" in post.featured_media:
            uses.append((featured_asset_id(post.featured_media, post.site_id), "featured", "featured_media"))
    document = post.metadata.get("post_editor", {})
    for asset, node, _alt in article_images(document.get("html", "")):
        uses.append((asset, node, "editor_document.image"))
    return uses


def validate_post_images(post, *, actor=None, using="default"):
    media = post.metadata.get("post_media", {})
    if not isinstance(media, dict) or set(media) - {"featured_alt"}:
        raise ValidationError({"featured_alt": "Use the supported featured image alternative text field."})
    uses = image_uses(post)
    if not uses:
        return uses
    if actor is not None:
        authorize(actor, post.site_id, "content.media.view", using=using)
    identifiers = {asset for asset, _, _ in uses}
    rows = MediaAsset.objects.using(using).filter(
        pk__in=identifiers, site_id=post.site_id, deleted_at__isnull=True,
        status="READY", detected_mime__in=READY_IMAGE_TYPES,
    ).exclude(processing__state__in=["QUEUED", "PROCESSING", "RETRY", "FAILED"])
    available = {str(pk) for pk in rows.values_list("pk", flat=True)}
    for asset, node, field in uses:
        if asset not in available:
            key = "featured_media" if node == "featured" else "editor_document"
            raise ValidationError({key: "Select an available ready image owned by this Site."})
    if any(node == "featured" for _, node, _ in uses):
        alt = media.get("featured_alt", "")
        if not isinstance(alt, str) or not alt.strip() or len(alt) > 1000:
            raise ValidationError({"featured_alt": "Describe the featured image in 1 to 1000 characters."})
    return uses


def record_post_images(post, revision, *, using):
    from apps.cms.models import _workflow_write
    if post.status in {"UNPUBLISHED", "ARCHIVED"} or (_workflow_write.get() and post.status == "DRAFT"):
        return
    uses = validate_post_images(post, using=using)
    if not uses:
        return
    actor = post.updated_by or post.created_by
    if actor is None:
        raise ValidationError({"media": "An identified editor is required for article media."})
    with _media_write_session(actor, post.site_id, using=using):
        MediaAssetReference.objects.using(using).bulk_create([
            MediaAssetReference(
                site_id=post.site_id, asset_id=asset, page_revision=revision,
                node_id=node, field_path=field, created_by=actor,
            ) for asset, node, field in uses
        ])
