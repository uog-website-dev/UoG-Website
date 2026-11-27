"""Authorize and stream Event resource files; revalidate on every request."""
from __future__ import annotations

import hashlib
import hmac
import time
from uuid import UUID

from django.conf import settings
from django.core.exceptions import ValidationError
from django.http import Http404, StreamingHttpResponse
from django.utils.http import content_disposition_header
from rest_framework.exceptions import NotAuthenticated, PermissionDenied, ValidationError as APIValidationError
from rest_framework.throttling import SimpleRateThrottle

from apps.audit.writer import record_event
from apps.cms.event_models import Event, EventStatus
from apps.cms.event_registration_domain import normalize_email
from apps.cms.event_registration_models import (
    EventRegistration,
    RegistrationStatus,
    SEAT_HOLDING_STATUSES,
)
from apps.cms.event_resource_models import EventResource, ResourceVisibility
from apps.media.document_references import validate_document_file
from apps.media.models import MediaAsset
from apps.media.storage import ObjectStorage
from apps.sites.selectors.modules import module_is_available

GRANT_TTL_SECONDS = 300  # 5-minute short-lived download grants
ENTITLED_STATUSES = frozenset(SEAT_HOLDING_STATUSES) | {RegistrationStatus.CONFIRMED}


class ResourceFileThrottle(SimpleRateThrottle):
    scope = "event_resource_file"
    rate = "60/hour"

    def get_cache_key(self, request, view):
        site = getattr(request, "site", None)
        peer = request.META.get("REMOTE_ADDR", "unknown")
        identity = hashlib.sha256(f"{getattr(site, 'pk', 'none')}:{peer}".encode()).hexdigest()
        return self.cache_format % {"scope": self.scope, "ident": identity}


def _signing_key() -> bytes:
    return hashlib.sha256(f"event-resource-grant:{settings.SECRET_KEY}".encode()).digest()


def issue_download_grant(*, resource: EventResource, registration_id: UUID | None = None) -> dict:
    """Return a short-lived opaque grant for Registered Only downloads."""
    exp = int(time.time()) + GRANT_TTL_SECONDS
    payload = f"{resource.pk}:{resource.site_id}:{exp}:{registration_id or ''}"
    signature = hmac.new(_signing_key(), payload.encode(), hashlib.sha256).hexdigest()
    token = f"{exp}.{signature}"
    return {
        "grant": token,
        "expires_in": GRANT_TTL_SECONDS,
        "expires_at": exp,
        "download_path": (
            f"/api/v1/site-context/events/{resource.event.slug}/resources/{resource.pk}/file/"
            f"?grant={token}"
        ),
    }


def verify_download_grant(*, resource: EventResource, grant: str) -> bool:
    grant = (grant or "").strip()
    if not grant or "." not in grant:
        return False
    exp_raw, signature = grant.split(".", 1)
    try:
        exp = int(exp_raw)
    except (TypeError, ValueError):
        return False
    if exp < int(time.time()):
        return False
    # Registration id is optional in signed payload — accept any still-valid
    # signature that was issued for this resource+site before unpublish.
    # We bind visibility/state separately in authorize_resource_file.
    # Reconstruct candidate payloads with empty registration id (public path unused)
    # and reject if HMAC mismatches both empty and non-empty patterns by checking
    # against the empty-registration form used by entitlement endpoint.
    payload = f"{resource.pk}:{resource.site_id}:{exp}:"
    expected = hmac.new(_signing_key(), payload.encode(), hashlib.sha256).hexdigest()
    if hmac.compare_digest(expected, signature):
        return True
    # Also accept grants that embedded a registration id (legacy/compat).
    # Signature was computed with registration_id; we cannot recover it, so
    # entitlement endpoint always issues empty registration binding.
    return False


def verify_registration_entitlement(*, event: Event, email: str, token: str) -> EventRegistration:
    email_norm = normalize_email(email)
    token = (token or "").strip()
    if not email_norm or not token:
        raise NotAuthenticated("Provide your registration email and management token.")
    row = EventRegistration.objects.filter(
        event_id=event.pk,
        email_normalized=email_norm,
        management_token=token,
        deleted_at__isnull=True,
        status__in=list(ENTITLED_STATUSES),
    ).first()
    if row is None:
        # Do not reveal whether the email exists.
        raise PermissionDenied("Registration entitlement could not be verified.")
    return row


def authorize_resource_file(
    *,
    event: Event,
    resource_id,
    request,
    management: bool = False,
    grant: str = "",
    email: str = "",
    token: str = "",
):
    """Live authorization for Event resource downloads. Never returns signed object URLs."""
    if not module_is_available(event.site_id, "EVENTS"):
        _deny(request, resource_id, event.site_id, "MODULE_DISABLED")
        raise Http404("Resource file is unavailable.")

    resource = (
        EventResource.objects.select_related("document", "event", "session")
        .filter(pk=resource_id, event_id=event.pk, site_id=event.site_id, removed_at__isnull=True)
        .first()
    )
    if resource is None:
        _deny(request, resource_id, event.site_id, "SITE_SCOPE_MISMATCH")
        raise Http404("Resource file is unavailable.")

    if management:
        return _ready_asset(resource, request)

    if event.status != EventStatus.PUBLISHED:
        _deny(request, resource_id, event.site_id, "EVENT_NOT_PUBLIC")
        raise Http404("Resource file is unavailable.")

    if resource.visibility == ResourceVisibility.DRAFT or resource.published_at is None:
        _deny(request, resource_id, event.site_id, "RESOURCE_NOT_PUBLISHED")
        raise Http404("Resource file is unavailable.")

    if resource.visibility == ResourceVisibility.PUBLIC:
        return _ready_asset(resource, request)

    # REGISTERED_ONLY: accept a still-valid short-lived grant OR live entitlement.
    if grant and verify_download_grant(resource=resource, grant=grant):
        return _ready_asset(resource, request)
    if email or token:
        verify_registration_entitlement(event=event, email=email, token=token)
        return _ready_asset(resource, request)

    _deny(request, resource_id, event.site_id, "REGISTRATION_REQUIRED")
    raise NotAuthenticated("Registration entitlement is required to download this file.")


def _ready_asset(resource: EventResource, request):
    try:
        asset = validate_document_file(resource.document.file_reference, resource.site_id)
    except ValidationError as error:
        _deny(request, resource.pk, resource.site_id, "FILE_NOT_READY")
        raise Http404("Resource file is unavailable.") from error

    if (
        asset.site_id != resource.site_id
        or asset.status != MediaAsset.Status.READY
        or asset.deleted_at is not None
        or getattr(getattr(asset, "processing", None), "state", None) != "READY"
    ):
        _deny(request, resource.pk, resource.site_id, "FILE_SECURITY_CHECK_FAILED")
        raise Http404("Resource file is unavailable.")

    try:
        bucket, key = asset.storage_reference.split(":", 1)
    except ValueError as error:
        _deny(request, resource.pk, resource.site_id, "INVALID_STORAGE_REFERENCE")
        raise Http404("Resource file is unavailable.") from error
    if bucket not in {"platform-private", "platform-documents"} or not key.startswith(
        f"sites/{resource.site_id}/"
    ):
        _deny(request, resource.pk, resource.site_id, "INVALID_STORAGE_SCOPE")
        raise Http404("Resource file is unavailable.")
    return resource, asset, bucket, key


def resource_file_response(*, request, resource: EventResource, asset, bucket, key):
    context = ObjectStorage().open(bucket, key)
    try:
        stream = context.__enter__()
    except Http404:
        raise
    except Exception as error:
        from rest_framework.exceptions import APIException
        raise APIException("File storage is temporarily unavailable.") from error

    params = getattr(request, "query_params", request.GET)
    inline = params.get("inline") == "1" and asset.detected_mime == "application/pdf"
    response = StreamingHttpResponse(_chunks(stream, context), content_type=asset.detected_mime)
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
    try:
        record_event(
            action="EVENT_RESOURCE_FILE_DELIVERED",
            entity_type="cms.event_resource",
            entity_id=resource.pk,
            after={"site_id": resource.site_id, "mime_type": asset.detected_mime},
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


def _deny(request, resource_id, site_id, reason):
    if request is None:
        return
    record_event(
        action="EVENT_RESOURCE_FILE_ACCESS_DENIED",
        entity_type="cms.event_resource",
        entity_id=resource_id,
        after={"site_id": site_id, "reason": reason},
        changed_fields=("access_denied",),
    )


def parse_file_query(request):
    params = request.query_params
    allowed = {"inline", "grant", "email", "token"}
    if set(params.keys()) - allowed:
        raise APIValidationError({"query": "Unsupported query parameter."})
    for name in params:
        if len(params.getlist(name)) != 1:
            raise APIValidationError({"query": f"Duplicate {name} parameter."})
    if "inline" in params and params.get("inline") != "1":
        raise APIValidationError({"query": "Only inline=1 is supported."})
    return {
        "inline": params.get("inline") == "1",
        "grant": params.get("grant", ""),
        "email": params.get("email", ""),
        "token": params.get("token", ""),
    }
