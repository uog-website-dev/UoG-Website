"""Central authorization and storage validation for Site document delivery."""
from django.core.exceptions import ValidationError
from django.http import Http404, StreamingHttpResponse
from django.utils import timezone
from django.utils.http import content_disposition_header
from rest_framework.throttling import SimpleRateThrottle
import hashlib
import ipaddress
import time

from apps.cms.models import ContentStatus, Document, Visibility
from apps.media.models import MediaAsset
from apps.sites.selectors.modules import module_is_available


class DocumentFileThrottle(SimpleRateThrottle):
    """Bound delivery attempts per Site and caller identity."""
    scope = "document_file"
    rate = "60/hour"

    def get_cache_key(self, request, view):
        site_id = view.kwargs.get("site_pk") or getattr(getattr(request, "site", None), "pk", "public")
        user = getattr(request, "user", None)
        if getattr(user, "is_authenticated", False):
            caller = f"user:{user.pk}"
        else:
            peer = request.META.get("REMOTE_ADDR", "")
            try:
                from apps.cms.api.widget_runtime import nginx_addresses
                forwarded = request.META.get("HTTP_X_REAL_IP", peer)
                address = forwarded if peer in nginx_addresses(int(time.monotonic() // 60)) else peer
                address = str(ipaddress.ip_address(address))
            except (ValueError, OSError):
                address = peer
            caller = f"ip:{address}"
        # Site-wide rather than per-document buckets make identifier probing
        # consume the same allowance as successful delivery.
        identity = hashlib.sha256(f"{site_id}:{caller}".encode()).hexdigest()
        return self.cache_format % {"scope": self.scope, "ident": identity}


def authorize_document_file(*, document_id, site, user, request=None, management=False):
    """Return the READY Site-owned asset only after live authorization checks.

    Public delivery is re-evaluated on every request. Management previews require
    an explicit Site document view grant and may inspect drafts/unpublished rows.
    """
    if request is not None:
        params = request.query_params
        if (
            set(params.keys()) - {"inline"}
            or any(len(params.getlist(name)) != 1 for name in params)
            or ("inline" in params and params.get("inline") != "1")
        ):
            from rest_framework.exceptions import ValidationError as APIValidationError
            raise APIValidationError({"query": "Only a single inline=1 parameter is supported."})
    if not module_is_available(site.pk, "DOCUMENTS"):
        _record_denial(request, document_id, site.pk, "MODULE_DISABLED")
        raise Http404("Document file is unavailable.")

    document = Document.objects.filter(pk=document_id, site_id=site.pk).first()
    if document is None:
        _record_denial(request, document_id, site.pk, "SITE_SCOPE_MISMATCH")
        raise Http404("Document file is unavailable.")

    if management:
        from apps.cms.models import ContentRole
        from apps.cms.authorization import require_cms_grant
        require_cms_grant(user, site.pk, tuple(ContentRole.values), request=request)
    else:
        if not (
            document.status == ContentStatus.PUBLISHED
            and document.published_at is not None
            and document.published_at <= timezone.now()
            and document.visibility == Visibility.PUBLIC
            and document.visible_to_public
        ):
            _record_denial(request, document_id, site.pk, "DOCUMENT_NOT_ELIGIBLE")
            raise Http404("Document file is unavailable.")
        if document.require_login_to_download and not (
            getattr(user, "is_authenticated", False) and getattr(user, "is_active", False)
        ):
            _record_denial(request, document_id, site.pk, "LOGIN_REQUIRED")
            from rest_framework.exceptions import NotAuthenticated
            raise NotAuthenticated("Sign in to download this document.")

    from apps.media.document_references import validate_document_file
    try:
        asset = validate_document_file(document.file_reference, site.pk)
    except (Http404, ValidationError) as error:
        _record_denial(request, document_id, site.pk, "FILE_NOT_READY")
        raise Http404("Document file is unavailable.") from error

    if (
        asset.site_id != site.pk
        or asset.status != MediaAsset.Status.READY
        or asset.deleted_at is not None
        or asset.detected_mime not in {
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/zip",
        }
        or getattr(getattr(asset, "processing", None), "state", None) != "READY"
    ):
        _record_denial(request, document_id, site.pk, "FILE_SECURITY_CHECK_FAILED")
        raise Http404("Document file is unavailable.")

    try:
        bucket, key = asset.storage_reference.split(":", 1)
    except ValueError as error:
        _record_denial(request, document_id, site.pk, "INVALID_STORAGE_REFERENCE")
        raise Http404("Document file is unavailable.") from error
    if bucket not in {"platform-private", "platform-documents"} or not key.startswith(f"sites/{site.pk}/"):
        _record_denial(request, document_id, site.pk, "INVALID_STORAGE_SCOPE")
        raise Http404("Document file is unavailable.")
    return document, asset, bucket, key


def document_file_response(*, request, document, asset, bucket, key):
    """Stream an authorized private object with safe, non-cacheable headers."""
    from rest_framework.exceptions import APIException
    from apps.audit.writer import record_event
    from apps.media.storage import ObjectStorage

    context = ObjectStorage().open(bucket, key)
    try:
        stream = context.__enter__()
    except Http404:
        raise
    except Exception as error:
        raise APIException("Document storage is temporarily unavailable.") from error

    inline = request.query_params.get("inline") == "1" and asset.detected_mime == "application/pdf"
    response = StreamingHttpResponse(
        _chunks(stream, context),
        content_type=asset.detected_mime,
    )
    response["Content-Disposition"] = content_disposition_header(not inline, asset.original_filename)
    response["Content-Length"] = str(asset.byte_count)
    response["Cache-Control"] = "private, no-store, max-age=0"
    response["Pragma"] = "no-cache"
    response["X-Content-Type-Options"] = "nosniff"
    response["X-Robots-Tag"] = "noindex, nofollow"
    response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    response["X-Frame-Options"] = "SAMEORIGIN"
    response["Cross-Origin-Resource-Policy"] = "same-origin"
    response["Vary"] = "Authorization, Cookie, Host"
    # The common audit writer sanitizes snapshots; never record credentials,
    # signed URLs, object keys, or caller-controlled filenames.
    try:
        record_event(
            action="DOCUMENT_FILE_DELIVERED",
            entity_type="cms.document",
            entity_id=document.pk,
            after={"site_id": document.site_id, "mime_type": asset.detected_mime},
            changed_fields=("download",),
        )
    except Exception:
        context.__exit__(None, None, None)
        raise
    return response


def _chunks(stream, context, chunk_size=64 * 1024):
    try:
        while True:
            chunk = stream.read(chunk_size)
            if not chunk:
                break
            yield chunk
    finally:
        context.__exit__(None, None, None)


def _record_denial(request, document_id, site_id, reason):
    if request is None:
        return
    from apps.audit.writer import record_event
    record_event(
        action="DOCUMENT_FILE_ACCESS_DENIED",
        entity_type="cms.document",
        entity_id=document_id,
        after={"site_id": site_id, "reason": reason},
        changed_fields=("access_denied",),
    )
