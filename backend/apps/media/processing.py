"""Durable, fenced and bounded image processing. Private versioned WebP variants."""
import hashlib
import io
import tempfile
import uuid
from contextlib import contextmanager
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import connection
from django.http import Http404
from django.utils import timezone
from PIL import Image, ImageOps

from apps.sites.models import Site
from .models import MediaAsset, MediaProcessing, MediaDerivative
from .services import _media_write_session, storage_parts
from .storage import ObjectStorage
from .object_lock import object_operation

VARIANTS = {"thumbnail": 320, "display": 1280}
POLICY_VERSION = "webp-v1"


class RetryableMediaError(Exception):
    pass


@contextmanager
def processing_write(asset):
    with _media_write_session(asset.created_by, asset.site_id):
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_setting('media.processing', true)")
            previous = cursor.fetchone()[0] or ""
            cursor.execute("SELECT set_config('media.processing', 'on', true)")
        try:
            yield
        finally:
            if not connection.needs_rollback:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT set_config('media.processing', %s, true)", [previous])


def usable(asset):
    return asset.status in {"PENDING", "READY"} and asset.site.status != "ARCHIVED"


def derivative_reference(asset, variant):
    if variant not in VARIANTS:
        raise ValueError("Unknown image variant")
    return f"platform-private:sites/{asset.site_id}/derivatives/{asset.pk}/{asset.checksum}/{POLICY_VERSION}-{variant}.webp"


def render_variant(stream, variant):
    """Re-encode decoded pixels only; EXIF/ICC and original names are discarded."""
    if variant not in VARIANTS:
        raise ValueError("Unknown image variant")
    stream.seek(0)
    with Image.open(stream) as source:
        if source.width * source.height > settings.MEDIA_IMAGE_MAX_PIXELS or getattr(source, "n_frames", 1) != 1:
            raise ValidationError("Image resource limit exceeded.")
        image = ImageOps.exif_transpose(source)
        image.thumbnail((VARIANTS[variant], VARIANTS[variant]), Image.Resampling.LANCZOS)
        # Construct a new pixel-only image to avoid copying container metadata.
        mode = "RGBA" if "A" in image.getbands() or "transparency" in image.info else "RGB"
        clean = Image.new(mode, image.size)
        clean.paste(image.convert(mode))
        output = io.BytesIO()
        clean.save(output, format="WEBP", quality=82, method=4, exact=True)
        data = output.getvalue()
        width, height = clean.size
        clean.close(); image.close()
    if len(data) > settings.MEDIA_DERIVATIVE_MAX_BYTES:
        raise ValidationError("Encoded derivative exceeds its byte limit.")
    return data, {"width": width, "height": height, "byte_count": len(data), "checksum": hashlib.sha256(data).hexdigest()}


def original_matches(asset, technical):
    return all(getattr(asset, name) == value for name, value in technical.items()
               if name not in {"width", "height"} or getattr(asset, name) is not None)


def _locked_current(asset, token):
    row = MediaAsset.objects.select_for_update().select_related("site", "created_by").filter(pk=asset.pk, site_id=asset.site_id).first()
    job = MediaProcessing.objects.select_for_update().filter(asset_id=asset.pk, token=token, state="PROCESSING").first()
    if row is None or job is None or not usable(row):
        return None, None
    return row, job


def _failed(asset, token, code, *, permanent=False):
    current = MediaAsset.objects.select_related("site").filter(pk=asset.pk).first()
    if current is None or not usable(current):
        return
    with processing_write(asset):
        row, job = _locked_current(asset, token)
        if row is None:
            return
        terminal = permanent or job.attempts >= settings.MEDIA_PROCESSING_MAX_ATTEMPTS
        job.state = "FAILED" if terminal else "RETRY"
        job.failure_code = code
        job.lease_until = None
        job.available_at = timezone.now() + timedelta(seconds=settings.MEDIA_PROCESSING_RETRY_SECONDS * (2 ** max(0, job.attempts - 1)))
        job.save()
        if terminal:
            row.status = "REJECTED"
            row.updated_by = row.created_by
            row.save(update_fields=["status", "updated_by", "updated_at"])
    if not terminal:
        raise RetryableMediaError(code)


def process_asset(asset_id, *, storage=None):
    with object_operation(asset_id) as acquired:
        if not acquired:
            return MediaAsset.objects.filter(pk=asset_id).first()
        return _process_asset(asset_id, storage=storage)


def _process_asset(asset_id, *, storage=None):
    from .uploads import inspect_upload, UploadTooLarge
    asset = MediaAsset.objects.select_related("site", "created_by").filter(pk=asset_id).first()
    if asset is None or not usable(asset):
        return asset
    storage = storage or ObjectStorage()
    with processing_write(asset):
        asset = MediaAsset.objects.select_for_update().select_related("site", "created_by").get(pk=asset.pk)
        if not usable(asset):
            return asset
        job, _ = MediaProcessing.objects.get_or_create(asset=asset)
        now = timezone.now()
        if job.state in {"READY", "FAILED"}:
            return asset
        if job.state == "PROCESSING" and job.lease_until and job.lease_until > now:
            return asset
        if job.state == "RETRY" and job.available_at > now:
            return asset
        if job.attempts >= settings.MEDIA_PROCESSING_MAX_ATTEMPTS:
            # A timed-out/killed final delivery must also become terminal.
            job.state = "PROCESSING"; job.token = uuid.uuid4(); job.save()
            exhausted = True
        else:
            job.attempts += 1
            job.state = "PROCESSING"; job.token = uuid.uuid4()
            job.lease_until = now + timedelta(seconds=settings.MEDIA_PROCESSING_LEASE_SECONDS)
            job.failure_code = ""; job.save()
            exhausted = False
        token = job.token
    if exhausted:
        _failed(asset, token, "RETRY_EXHAUSTED", permanent=True)
        asset.refresh_from_db()
        return asset
    try:
        bucket, key = storage_parts(asset.storage_reference, asset.site_id)
        with storage.open(bucket, key) as incoming, tempfile.TemporaryFile() as spool:
            technical = inspect_upload(incoming, spool)
            if not original_matches(asset, technical):
                raise ValidationError("Original metadata mismatch.")
            variants = {name: render_variant(spool, name) for name in VARIANTS} if technical["detected_mime"].startswith("image/") else {}
        # Remote writes hold only this asset's session mutex. Cleanup uses the
        # same mutex, so it cannot finish before an in-flight PUT has returned.
        for variant, (data, _) in variants.items():
            reference = derivative_reference(asset, variant)
            storage.put(*reference.split(":", 1), io.BytesIO(data), content_type="image/webp")
        with processing_write(asset):
            row, job = _locked_current(asset, token)
            if row is None:
                return MediaAsset.objects.filter(pk=asset.pk).first()
            for variant, (_, metadata) in variants.items():
                reference = derivative_reference(row, variant)
                derivative, _ = MediaDerivative.objects.get_or_create(asset=row, variant=variant, defaults={"storage_reference": reference, **metadata})
                if derivative.storage_reference != reference or any(getattr(derivative, key) != value for key, value in metadata.items()):
                    raise ValidationError("Derivative identity mismatch.")
            job.state = "READY"; job.failure_code = ""; job.lease_until = None; job.save()
            if row.status == "PENDING":
                row.status = "READY"; row.updated_by = row.created_by
                row.save(update_fields=["status", "updated_by", "updated_at"])
        return row
    except (ValidationError, UploadTooLarge, Image.DecompressionBombError):
        _failed(asset, token, "INVALID_IMAGE", permanent=True)
    except Http404:
        _failed(asset, token, "ORIGINAL_MISSING", permanent=True)
    except Exception:
        # Do not store credentials, object keys or provider exception strings.
        _failed(asset, token, "PROCESSING_IO")
    asset.refresh_from_db()
    return asset
