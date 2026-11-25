"""Site ownership and immutable revision references for document assets."""
from django.core.exceptions import ValidationError
from uuid import UUID


def validate_document_file(reference, site_id, using=None):
    from .models import MediaAsset
    prefix = f"sites/{site_id}/assets/"
    if not isinstance(reference, str) or not reference.startswith(prefix):
        raise ValidationError({"file_reference": "Choose a file uploaded to this Site."})
    asset_id = reference[len(prefix):]
    try:
        asset_id = UUID(asset_id)
    except (TypeError, ValueError, AttributeError) as error:
        raise ValidationError({"file_reference": "Choose a valid uploaded document file."}) from error
    asset = MediaAsset.objects.using(using).filter(pk=asset_id, site_id=site_id, deleted_at__isnull=True, status="READY", detected_mime__in=(
        "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip",
    )).first()
    if not asset:
        raise ValidationError({"file_reference": "The file is unavailable, still being scanned, or belongs to another Site."})
    try:
        ready = asset.processing.state == "READY"
    except MediaProcessing.DoesNotExist:
        ready = False
    if not ready:
        raise ValidationError({"file_reference": "Wait for the security scan to finish before attaching this file."})
    return asset


def record_document_file(document, revision, *, using):
    from .models import MediaAssetReference
    from .services import _media_write_session

    asset = validate_document_file(document.file_reference, document.site_id, using=using)
    actor = document.updated_by or document.created_by
    if actor is None:
        raise ValidationError({"file_reference": "A user is required to record this file reference."})
    with _media_write_session(actor, document.site_id, using=using):
        MediaAssetReference.objects.using(using).create(
            site_id=document.site_id, asset=asset, page_revision=revision,
            node_id="document-file", field_path="file_reference",
            created_by=actor,
        )
