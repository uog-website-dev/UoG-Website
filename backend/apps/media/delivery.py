"""Scoped image bytes; no object keys, signed URLs or public originals."""
import hashlib
import tempfile

from django.http import Http404, HttpResponse
from django.core.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView
from rest_framework.renderers import BaseRenderer, JSONRenderer
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema, OpenApiParameter

from apps.sites.selectors.modules import module_available_on_request
from .models import MediaAsset, MediaDerivative
from .processing import VARIANTS, render_variant, derivative_reference, original_matches
from .storage import ObjectStorage


class WebPImageRenderer(BaseRenderer):
    media_type = "image/webp"
    format = "webp"
    def render(self, data, accepted_media_type=None, renderer_context=None):
        return data if isinstance(data, bytes) else b""


class ImageDeliveryMixin:
    # Permit strict Accept: image/webp without turning error envelopes into images.
    renderer_classes = [WebPImageRenderer, JSONRenderer]
    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        if isinstance(response, Response) and response.status_code >= 400:
            response.accepted_renderer = JSONRenderer()
            response.accepted_media_type = "application/json"
        return response


def image_response(asset, variant, *, storage=None, eligible=None):
    from .uploads import inspect_upload, UploadTooLarge
    if asset.status != "READY" or asset.site.status == "ARCHIVED" or not asset.detected_mime.startswith("image/") or variant not in VARIANTS:
        raise Http404("Image unavailable.")
    job = getattr(asset, "processing", None)
    if job is not None and job.state != "READY":
        raise Http404("Image processing is not ready.")
    storage = storage or ObjectStorage()
    derivative = MediaDerivative.objects.filter(asset=asset, variant=variant).first()
    data = None
    fallback = False
    if derivative and derivative.storage_reference == derivative_reference(asset, variant):
        try:
            with storage.open(*derivative.storage_reference.split(":", 1)) as stream:
                from django.conf import settings
                candidate = stream.read(settings.MEDIA_DERIVATIVE_MAX_BYTES + 1)
            if len(candidate) == derivative.byte_count and hashlib.sha256(candidate).hexdigest() == derivative.checksum:
                data = candidate
        except Exception:
            # Provider outages never expose their exception text or object key.
            pass
    if data is None:
        fallback = True
        try:
            with storage.open(*asset.storage_reference.split(":", 1)) as incoming, tempfile.TemporaryFile() as spool:
                technical = inspect_upload(incoming, spool)
                if not original_matches(asset, technical):
                    raise Http404("Original verification failed.")
                data, _ = render_variant(spool, variant)
        except (ValidationError, UploadTooLarge, KeyError, Http404) as error:
            raise Http404("Image unavailable.") from error
        except Exception as error:
            from .uploads import StorageUnavailable
            raise StorageUnavailable() from error
    # Recheck lifecycle after I/O. Never reuse another Site's fallback/cache.
    if not MediaAsset.objects.filter(pk=asset.pk, site_id=asset.site_id, status="READY", deleted_at__isnull=True).exclude(site__status="ARCHIVED").exists():
        raise Http404("Image unavailable.")
    if eligible is not None and not eligible():
        raise Http404("Image unavailable.")
    response = HttpResponse(data, content_type="image/webp")
    response["Cache-Control"] = "private, no-store"
    response["Vary"] = "Host, Authorization, Cookie"
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Disposition"] = 'inline; filename="image.webp"'
    response["X-Media-Fallback"] = "original-regenerated" if fallback else "stored-derivative"
    return response


def is_published(asset):
    from .models import MediaUsage
    return MediaUsage.objects.filter(asset=asset,site_id=asset.site_id,scope="PUBLIC",page__status="PUBLISHED",page__visibility__in=["PUBLIC","UNLISTED"]).exists()


class PublicMediaImage(ImageDeliveryMixin, APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        response["Vary"] = "Host, Authorization, Cookie"
        return response

    @extend_schema(tags=["Media"], parameters=[OpenApiParameter("variant", str, enum=list(VARIANTS))], responses={(200, "image/webp"): {"type": "string", "format": "binary"}}, description="Host-resolved Site only, effective MEDIA/PAGES and a current published visible Page reference required. READY images only. Missing derivatives regenerate bounded WebP from verified private original; missing/invalid original is 404. No public original or storage keys. No-store, Vary Host.")
    def get(self, request, asset_id):
        site = getattr(request, "site", None)
        if site is None or not module_available_on_request(request, "MEDIA") or not module_available_on_request(request, "PAGES"):
            raise Http404("Image unavailable.")
        asset = MediaAsset.objects.select_related("site", "processing").filter(pk=asset_id, site=site, status="READY").first()
        if asset is None or not is_published(asset):
            raise Http404("Image unavailable.")
        return image_response(asset, request.query_params.get("variant", "display"), eligible=lambda: is_published(asset))
