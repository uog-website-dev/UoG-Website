"""Private, bounded uploads with durable retry identity and processing outbox."""
import hashlib
import logging
import tempfile
import uuid
import warnings
import zipfile
import posixpath
import stat
import xml.etree.ElementTree as ET
import zlib
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException

from .models import MediaAsset, MediaUpload, MediaUploadAttempt
from .selectors import authorize
from .services import _media_write_session, asset_write, storage_parts
from .storage import ObjectStorage

log = logging.getLogger(__name__)


class UploadTooLarge(APIException):
    status_code = 413
    default_detail = "Upload exceeds the configured byte limit."


class UploadBusy(APIException):
    status_code = 409
    default_detail = "This upload is still transferring. Retry with the same Idempotency-Key later."


class StorageUnavailable(APIException):
    status_code = 503
    default_detail = "Private storage is unavailable. Retry using the same Idempotency-Key."


def limits():
    return {"image_max_bytes": min(settings.MEDIA_IMAGE_MAX_BYTES, settings.MEDIA_UPLOAD_MAX_BYTES),
            "text_max_bytes": min(settings.MEDIA_TEXT_MAX_BYTES, settings.MEDIA_UPLOAD_MAX_BYTES),
            "pdf_max_bytes": min(settings.MEDIA_PDF_MAX_BYTES, settings.MEDIA_UPLOAD_MAX_BYTES),
            "document_max_bytes": min(settings.MEDIA_DOCUMENT_MAX_BYTES, settings.MEDIA_UPLOAD_MAX_BYTES),
            "image_max_pixels": settings.MEDIA_IMAGE_MAX_PIXELS,
            "mime_types": ["image/png", "image/jpeg", "image/webp", "text/plain", "application/pdf",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip"],
            "extensions": [".png", ".jpg", ".jpeg", ".webp", ".txt", ".pdf", ".docx", ".xlsx", ".zip"]}


DOCUMENT_MIMES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".zip": "application/zip",
}
EXTENSION_MIMES = {**DOCUMENT_MIMES, ".txt": "text/plain", ".png": "image/png",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}


def _validate_archive(stream, *, package_type=None):
    """Inspect archive structure while it remains quarantined and private."""
    stream.seek(0)
    try:
        with zipfile.ZipFile(stream) as archive:
            entries = archive.infolist()
            if not entries or len(entries) > 5000:
                raise ValueError("Archive entry count is not allowed.")
            total = 0
            names = set()
            for item in entries:
                name = item.filename.replace("\\", "/")
                normalized = posixpath.normpath(name)
                components = normalized.split("/")
                mode = item.external_attr >> 16
                if (not name or name.startswith("/") or any(part == ".." for part in components)
                        or ":" in components[0] or stat.S_ISLNK(mode) or item.flag_bits & 0x1):
                    raise ValueError("Unsafe or encrypted archive entry.")
                if normalized in names:
                    raise ValueError("Duplicate archive paths are not allowed.")
                names.add(normalized)
                total += item.file_size
                if total > 250 * 1024 * 1024 or (item.file_size > 1024 * 1024 and item.compress_size == 0) or (
                    item.compress_size and item.file_size > max(10 * 1024 * 1024, item.compress_size * 100)
                ):
                    raise ValueError("Archive expansion limit exceeded.")
                if name.lower().endswith(("vbaproject.bin", ".js", ".jse", ".vbs", ".ps1", ".bat", ".cmd", ".exe", ".scr")):
                    raise ValueError("Active content is not allowed in document archives.")
            if package_type:
                required = {"[Content_Types].xml", "_rels/.rels", package_type}
                if not required.issubset(names):
                    raise ValueError("Office package structure is invalid.")
                for member in ("[Content_Types].xml", package_type):
                    if archive.getinfo(member).file_size > 8 * 1024 * 1024:
                        raise ValueError("Office package metadata is too large.")
                    ET.fromstring(archive.read(member))
            if archive.testzip() is not None:
                raise ValueError("Archive member checksum is invalid.")
    except (zipfile.BadZipFile, OSError, RuntimeError, KeyError, ET.ParseError, zlib.error, EOFError) as error:
        raise ValidationError("Invalid or corrupted document archive.") from error
    except ValueError as error:
        raise ValidationError(str(error)) from error
    finally:
        stream.seek(0)


def inspect_upload(stream, destination, *, filename=None):
    """Bound disk/memory while reading; no client MIME or suffix is authoritative."""
    total, digest, prefix = 0, hashlib.sha256(), b""
    while True:
        chunk = stream.read(min(65536, settings.MEDIA_UPLOAD_MAX_BYTES - total + 1))
        if not chunk:
            break
        total += len(chunk)
        if total > settings.MEDIA_UPLOAD_MAX_BYTES:
            raise UploadTooLarge()
        digest.update(chunk)
        destination.write(chunk)
        prefix = (prefix + chunk)[:32]
    if not total:
        raise ValidationError("Empty files are not allowed.")
    destination.seek(0)
    width = height = None
    suffix = posixpath.splitext(filename.lower())[1] if filename else None
    if prefix.startswith(b"%PDF-"):
        if total > settings.MEDIA_PDF_MAX_BYTES:
            raise UploadTooLarge("PDF exceeds the configured PDF limit.")
        validate_pdf(destination)
        mime = "application/pdf"
    elif prefix.startswith(b"PK\x03\x04"):
        if total > settings.MEDIA_DOCUMENT_MAX_BYTES:
            raise UploadTooLarge("Document exceeds the configured document limit.")
        if suffix not in {".docx", ".xlsx", ".zip"}:
            raise ValidationError("ZIP-based documents must use a .docx, .xlsx or .zip filename.")
        package_type = {".docx": "word/document.xml", ".xlsx": "xl/workbook.xml"}.get(suffix)
        _validate_archive(destination, package_type=package_type)
        mime = DOCUMENT_MIMES[suffix]
    elif prefix.startswith((b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff")) or (prefix.startswith(b"RIFF") and prefix[8:12] == b"WEBP"):
        if total > settings.MEDIA_IMAGE_MAX_BYTES:
            raise UploadTooLarge("Image exceeds the configured image limit.")
        from PIL import Image
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(destination) as image:
                    if image.format not in {"PNG", "JPEG", "WEBP"} or getattr(image, "n_frames", 1) != 1:
                        raise ValueError("Unsupported or animated image")
                    width, height = image.size
                    if width * height > settings.MEDIA_IMAGE_MAX_PIXELS:
                        raise ValueError("Image pixel limit exceeded")
                    mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}[image.format]
                    image.verify()
                destination.seek(0)
                with Image.open(destination) as image:
                    image.load()
        except Exception as error:
            raise ValidationError("Invalid, animated or oversized image.") from error
    else:
        if total > settings.MEDIA_TEXT_MAX_BYTES:
            raise UploadTooLarge("Text exceeds the configured text limit.")
        try:
            text = destination.read().decode("utf-8-sig")
        except UnicodeError as error:
            raise ValidationError("Unsupported media format.") from error
        # Plain text only: reject markup, controls and common executable headers.
        if any(ord(c) < 32 and c not in "\r\n\t" for c in text) or "<" in text or text.startswith(("MZ", "#!", "%!", "PK")):
            raise ValidationError("Unsafe or unsupported media format.")
        mime = "text/plain"
    if filename:
        expected_mime = EXTENSION_MIMES.get(suffix)
        if expected_mime is None:
            raise ValidationError("Unsupported file extension. Choose PDF, DOCX, XLSX or ZIP.")
        if expected_mime != mime:
            raise ValidationError("File extension does not match the detected file type.")
    elif mime in {DOCUMENT_MIMES[".docx"], DOCUMENT_MIMES[".xlsx"], DOCUMENT_MIMES[".zip"]}:
        raise ValidationError("A filename is required to validate this document type.")
    destination.seek(0)
    return dict(detected_mime=mime, byte_count=total, checksum=digest.hexdigest(), width=width, height=height)


def validate_pdf(stream):
    from pypdf import PdfReader
    from pypdf.generic import DictionaryObject, ArrayObject, IndirectObject
    forbidden = {"/JS", "/JavaScript", "/AA", "/OpenAction", "/Launch", "/RichMedia", "/EmbeddedFiles", "/EF", "/XFA", "/AcroForm", "/URI", "/SubmitForm", "/GoToR", "/A", "/Annots", "/AF", "/Collection", "/Sound", "/Movie", "/Rendition", "/3D"}
    try:
        reader = PdfReader(stream, strict=True)
        if reader.is_encrypted or not 0 < len(reader.pages) <= 1000:
            raise ValueError("Encrypted or excessive pages")
        seen, count = set(), 0
        def visit(obj):
            nonlocal count
            count += 1
            if count > 50000:
                raise ValueError("PDF structure too complex")
            if isinstance(obj, IndirectObject):
                key = (obj.idnum, obj.generation)
                if key in seen:
                    return
                seen.add(key)
                obj = obj.get_object()
            if isinstance(obj, DictionaryObject):
                if forbidden.intersection(obj.keys()):
                    raise ValueError("Active PDF content")
                for value in obj.values():
                    visit(value)
            elif isinstance(obj, ArrayObject):
                for value in obj:
                    visit(value)
        visit(reader.trailer)
    except Exception as error:
        raise ValidationError("Invalid, encrypted or active PDF documents are not allowed.") from error
    finally:
        stream.seek(0)


def enqueue(asset_id):
    # The durable upload->PENDING asset relation is the outbox; beat retries
    # dispatch if the broker was down at commit time.
    try:
        from .tasks import process_media_asset
        process_media_asset.delay(str(asset_id))
    except Exception:
        log.warning("Media processing dispatch deferred", extra={"asset_id": str(asset_id)})


def upload_asset(actor, site_id, stream, *, filename, request_key, storage=None, expected_length=None):
    authorize(actor, site_id, "content.media.upload")
    if not isinstance(filename, str) or not filename.strip() or len(filename) > 255 or any(c in filename for c in "\\/\x00\r\n") or any(ord(c) < 32 or ord(c) == 127 for c in filename):
        raise ValidationError("A filename without path components is required.")
    try:
        request_key = uuid.UUID(str(request_key))
    except (ValueError, TypeError, AttributeError) as error:
        raise ValidationError("Idempotency-Key must be a UUID.") from error
    storage = storage or ObjectStorage()
    with asset_write(actor, site_id, "content.media.upload"):
        upload, _ = MediaUpload.objects.get_or_create(site_id=site_id, creator=actor, request_key=request_key, defaults={"original_filename": filename})
        upload = MediaUpload.objects.select_for_update().get(pk=upload.pk)
        if upload.original_filename != filename:
            raise UploadBusy("This Idempotency-Key belongs to a different filename.")
        if upload.asset_id:
            return upload.asset
        if upload.attempts.filter(state="WRITING", expires_at__gt=timezone.now()).exists():
            raise UploadBusy()
        attempt_id = uuid.uuid4()
        reference = f"platform-private:sites/{site_id}/uploads/{upload.pk}/{attempt_id}"
        attempt = upload.attempts.create(id=attempt_id, storage_reference=reference, expires_at=timezone.now() + timedelta(seconds=settings.MEDIA_UPLOAD_LEASE_SECONDS))
    bucket, key = storage_parts(reference, site_id)
    try:
        with tempfile.TemporaryFile() as spool:
            technical = inspect_upload(stream, spool, filename=filename)
            if expected_length is not None and technical["byte_count"] != expected_length:
                raise ValidationError("Transfer was incomplete. Retry using the same Idempotency-Key.")
            # Single PUT avoids leaked S3 multipart uploads. Temporary disk bounds RAM.
            try:
                storage.put(bucket, key, spool, content_type=technical["detected_mime"])
            except Exception as error:
                raise StorageUnavailable() from error
        with asset_write(actor, site_id, "content.media.upload"):
            upload = MediaUpload.objects.select_for_update().get(pk=upload.pk)
            attempt.refresh_from_db()
            if attempt.state != "WRITING" or attempt.expires_at <= timezone.now() or upload.asset_id:
                raise UploadBusy("Transfer lease expired. Retry using the same Idempotency-Key.")
            asset = MediaAsset.objects.create(site_id=site_id, storage_reference=reference,
                original_filename=filename, created_by=actor, updated_by=actor, **technical)
            from .models import MediaProcessing
            MediaProcessing.objects.create(asset=asset)
            upload.asset = asset
            upload.save(update_fields=["asset"])
            attempt.state = "STORED"
            attempt.save(update_fields=["state"])
            transaction.on_commit(lambda: enqueue(asset.pk))
        return asset
    except Exception:
        # A commit response can be lost after PostgreSQL committed. Never delete
        # blindly: resolve durable identity under the same session lock used by
        # completion/reconciliation. If DB state is uncertain, defer all cleanup.
        try:
            with transaction.atomic():
                MediaUpload.objects.select_for_update().get(pk=upload.pk)
                if not MediaAsset.objects.filter(storage_reference=reference).exists():
                    MediaUploadAttempt.objects.filter(pk=attempt.pk, state="WRITING").update(state="FAILED")
                    try:
                        storage.delete(bucket, key)
                    except Exception:
                        # Keep FAILED committed so a delete outage does not block
                        # an immediate retry behind the old transfer lease.
                        log.warning("Media object cleanup deferred", extra={"attempt_id": str(attempt.pk)})
        except Exception:
            log.warning("Media attempt cleanup deferred", extra={"attempt_id": str(attempt.pk)})
        raise


def process_asset(asset_id, *, storage=None):
    from .processing import process_asset as process
    return process(asset_id, storage=storage or ObjectStorage())


def reconcile_attempts(*, storage=None):
    storage = storage or ObjectStorage()
    removed = 0
    candidates = MediaUploadAttempt.objects.filter(expires_at__lte=timezone.now()).exclude(state="STORED").values_list("pk", "upload_id")
    for attempt_id, upload_id in candidates.iterator():
        with transaction.atomic():
            MediaUpload.objects.select_for_update().get(pk=upload_id)
            attempt = MediaUploadAttempt.objects.select_for_update().get(pk=attempt_id)
            if MediaAsset.objects.filter(storage_reference=attempt.storage_reference).exists() or attempt.state == "STORED":
                continue
            bucket, key = storage_parts(attempt.storage_reference, attempt.upload.site_id)
            storage.delete(bucket, key)
            attempt.state = "FAILED"
            attempt.save(update_fields=["state"])
            removed += 1
    # Retain tombstones: repeat deletes catch a remote PUT that finished after
    # its lease expired or after the original uploader process died.
    return removed
