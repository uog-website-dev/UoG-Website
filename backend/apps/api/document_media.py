"""Retained Site document file references."""
import re
from django.core.exceptions import ValidationError
from apps.media.models import MediaAsset, MediaAssetReference
from apps.media.services import _media_write_session

REFERENCE = re.compile(r"^sites/([1-9][0-9]*)/assets/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$", re.I)
DOCUMENT_MIMES = ("application/pdf", "text/plain")

def validate_document_file(reference, site_id, *, using="default"):
    match = REFERENCE.fullmatch(reference or "")
    if not match or int(match.group(1)) != int(site_id):
        raise ValidationError({"file_reference": "Choose an uploaded document from this Site's media library."})
    asset = MediaAsset.objects.using(using).filter(
        pk=match.group(2), site_id=site_id, status="READY", deleted_at__isnull=True,
        detected_mime__in=DOCUMENT_MIMES,
    ).exclude(processing__state__in=("QUEUED", "PROCESSING", "RETRY", "FAILED")).first()
    if asset is None:
        raise ValidationError({"file_reference": "Choose a ready PDF or text document belonging to this Site."})
    return asset

def record_document_file(document, revision, *, using="default"):
    asset = validate_document_file(document.file_reference, document.site_id, using=using)
    actor = document.updated_by or document.created_by
    if actor is None:
        raise ValidationError({"file_reference": "An identified editor is required to attach a document file."})
    with _media_write_session(actor, document.site_id, using=using):
        MediaAssetReference.objects.using(using).create(
            site_id=document.site_id, asset=asset, page_revision=revision,
            node_id="document-file", field_path="file_reference", created_by=actor,
        )
