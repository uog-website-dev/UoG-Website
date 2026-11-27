"""Public Event registration and Site Admin registrant inventory."""
from __future__ import annotations

import hashlib
import ipaddress
import socket
import time
from functools import lru_cache
from urllib.parse import urlsplit

from django.core.exceptions import ValidationError as DomainValidationError
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.cms.event_domain import public_events_for_site, require_events_admin
from apps.cms.event_models import Event
from apps.cms.event_registration_domain import (
    RegistrationClosed,
    RegistrationDuplicate,
    RegistrationFull,
    RegistrationNotFound,
    cancel_registration,
    create_registration,
    registration_summary,
    serialize_registration,
)
from apps.cms.event_registration_models import EventRegistration, RegistrationStatus
from apps.sites.api.access import Conflict
from apps.sites.events import EVENTS_MODULE_CODE
from apps.sites.models import Site
from apps.sites.selectors.modules import module_is_available


class StrictFields:
    def to_internal_value(self, data):
        if isinstance(data, dict):
            writable = {name for name, field in self.fields.items() if not field.read_only}
            forbidden = set(data) - writable
            if forbidden:
                raise serializers.ValidationError({
                    key: ["Unknown, read-only, or immutable field."] for key in sorted(forbidden)
                })
        return super().to_internal_value(data)


class RegistrationInput(StrictFields, serializers.Serializer):
    request_id = serializers.UUIDField()
    participant_name = serializers.CharField(max_length=200)
    email = serializers.EmailField()
    organization = serializers.CharField(required=False, allow_blank=True, max_length=255)
    phone = serializers.CharField(required=False, allow_blank=True, max_length=64)
    consent = serializers.BooleanField()
    consent_text = serializers.CharField(required=False, allow_blank=True, max_length=500)
    website = serializers.CharField(required=False, allow_blank=True, max_length=200)


class RegistrationCancelInput(StrictFields, serializers.Serializer):
    email = serializers.EmailField()
    token = serializers.CharField(max_length=64)


class RegistrationReceipt(serializers.Serializer):
    id = serializers.UUIDField()
    status = serializers.CharField()
    management_token = serializers.CharField()
    waitlist_position = serializers.IntegerField(allow_null=True)
    notification_status = serializers.CharField()


class RegistrationSummarySerializer(serializers.Serializer):
    confirmed = serializers.IntegerField()
    waitlisted = serializers.IntegerField()
    cancelled = serializers.IntegerField()
    capacity = serializers.IntegerField(allow_null=True)
    seats_remaining = serializers.IntegerField(allow_null=True)
    state = serializers.CharField()


@lru_cache(maxsize=2)
def nginx_addresses(time_window):
    try:
        return set(socket.gethostbyname_ex("nginx")[2])
    except OSError:
        return set()


class RegistrationThrottle(SimpleRateThrottle):
    scope = "event_registration"
    rate = "10/min"

    def get_cache_key(self, request, view):
        site = getattr(request, "site", None)
        peer = request.META.get("REMOTE_ADDR", "")
        address = request.META.get("HTTP_X_REAL_IP", peer) if peer in nginx_addresses(int(time.monotonic() // 60)) else peer
        try:
            address = str(ipaddress.ip_address(address))
        except ValueError:
            address = peer
        visitor = hashlib.sha256(address.encode()).hexdigest()
        return f"cms:event-reg:{site.pk if site else 'none'}:{visitor}"


class RegistrationBodyTooLarge(APIException):
    status_code = 413
    default_detail = "The registration request exceeds the size limit."


def _public_event(request, slug) -> Event:
    site = getattr(request, "site", None)
    if site is None or not module_is_available(site.pk, EVENTS_MODULE_CODE):
        raise NotFound("Events are not available for this Site.")
    rows = public_events_for_site(site).filter(slug=slug)
    event = rows.filter(site_id=site.pk).first() or rows.first()
    if event is None:
        raise NotFound("Event not found.")
    return event


class PublicSiteEventRegistrations(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [RegistrationThrottle]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        response["Vary"] = "Host, Origin"
        return response

    @extend_schema(
        operation_id="v1_site_context_events_registrations_create",
        tags=["Public Events"],
        request=RegistrationInput,
        responses={201: RegistrationReceipt, 202: RegistrationReceipt},
        description=(
            "Anonymous Event registration with atomic capacity enforcement. "
            "Duplicate active emails return 409. Full Events without waitlist return 409. "
            "Honeypot field `website` must be blank. Rate limit: 10/min per Site visitor."
        ),
    )
    def post(self, request, slug):
        event = _public_event(request, slug)
        origin = request.headers.get("Origin")
        if origin and urlsplit(origin).netloc.lower() != request.get_host().lower():
            raise PermissionDenied("Submit the form from this Site.")
        if int(request.META.get("CONTENT_LENGTH") or 0) > 16384:
            raise RegistrationBodyTooLarge()
        payload = RegistrationInput(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        try:
            row = create_registration(event, data, website=data.get("website", ""))
        except RegistrationClosed as error:
            raise ValidationError({"non_field_errors": [str(error)]}) from error
        except RegistrationFull as error:
            raise Conflict(str(error)) from error
        except RegistrationDuplicate as error:
            raise Conflict(str(error)) from error
        except DomainValidationError as error:
            if hasattr(error, "message_dict"):
                raise ValidationError(error.message_dict) from error
            raise ValidationError({"non_field_errors": error.messages}) from error
        status_code = 202 if row.status == RegistrationStatus.WAITLISTED else 201
        return Response(serialize_registration(row, public=True), status=status_code)


class PublicSiteEventRegistrationCancel(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [RegistrationThrottle]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        response["Vary"] = "Host, Origin"
        return response

    @extend_schema(
        operation_id="v1_site_context_events_registrations_cancel",
        tags=["Public Events"],
        request=RegistrationCancelInput,
        responses={200: RegistrationReceipt},
        description=(
            "Cancel using email + management token issued at registration. "
            "Unknown pairs return 404 without revealing whether the email exists. "
            "Freed seats promote the oldest waitlisted registration."
        ),
    )
    def post(self, request, slug):
        event = _public_event(request, slug)
        payload = RegistrationCancelInput(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            row = cancel_registration(
                event=event,
                email=payload.validated_data["email"],
                token=payload.validated_data["token"],
            )
        except RegistrationNotFound as error:
            raise NotFound(str(error)) from error
        return Response(serialize_registration(row, public=True))


class SiteEventRegistrations(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_registrations_list",
        tags=["Event Registrations"],
        responses={200: RegistrationSummarySerializer},
        parameters=[OpenApiParameter("status", str)],
    )
    def get(self, request, site_pk, event_id):
        site = get_object_or_404(Site, pk=site_pk)
        if not module_is_available(site.pk, EVENTS_MODULE_CODE):
            raise PermissionDenied("Events are not enabled for this Site.")
        require_events_admin(request.user, site)
        event = get_object_or_404(Event, pk=event_id, site_id=site.pk)
        status = request.query_params.get("status", "").strip()
        rows = EventRegistration.objects.filter(event_id=event.pk).order_by("created_at", "id")
        if status:
            rows = rows.filter(status=status)
        response = Response({
            "summary": registration_summary(event),
            "results": [serialize_registration(row, public=False) for row in rows[:500]],
        })
        response["Cache-Control"] = "private, no-store"
        return response
