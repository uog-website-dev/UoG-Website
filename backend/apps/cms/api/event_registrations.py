"""Public Event registration and Site Admin participant administration."""
from __future__ import annotations

import hashlib
import ipaddress
import socket
import time
from functools import lru_cache
from urllib.parse import urlsplit

from django.core.exceptions import ValidationError as DomainValidationError
from django.http import HttpResponse
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.audit.writer import record_event
from apps.cms.event_access import admin_event, owned_child, public_event
from apps.cms.event_registration_domain import (
    RegistrationClosed,
    RegistrationDuplicate,
    RegistrationFull,
    RegistrationNotFound,
    admin_create_participant,
    admin_set_status,
    admin_update_participant,
    build_participants_csv,
    cancel_registration,
    create_registration,
    list_participants,
    registration_summary,
    serialize_badge,
    serialize_registration,
)
from apps.cms.event_registration_models import (
    EventRegistration,
    ParticipantCategory,
    RegistrationStatus,
)
from apps.sites.api.access import Conflict


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
    invited = serializers.IntegerField()
    capacity = serializers.IntegerField(allow_null=True)
    seats_remaining = serializers.IntegerField(allow_null=True)
    state = serializers.CharField()


class AdminParticipantCreateInput(StrictFields, serializers.Serializer):
    request_id = serializers.UUIDField(required=False)
    participant_name = serializers.CharField(max_length=200)
    email = serializers.EmailField()
    organization = serializers.CharField(required=False, allow_blank=True, max_length=255)
    phone = serializers.CharField(required=False, allow_blank=True, max_length=64)
    display_category = serializers.ChoiceField(
        choices=ParticipantCategory.choices, required=False, default=ParticipantCategory.PARTICIPANT,
    )
    mode = serializers.ChoiceField(choices=["invite", "register"], default="invite")


class AdminParticipantUpdateInput(StrictFields, serializers.Serializer):
    participant_name = serializers.CharField(required=False, max_length=200)
    organization = serializers.CharField(required=False, allow_blank=True, max_length=255)
    phone = serializers.CharField(required=False, allow_blank=True, max_length=64)
    display_category = serializers.ChoiceField(choices=ParticipantCategory.choices, required=False)


class AdminParticipantActionInput(StrictFields, serializers.Serializer):
    action = serializers.ChoiceField(choices=["confirm", "cancel", "delete"])


class ParticipantAdminSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    event = serializers.UUIDField()
    site = serializers.IntegerField()
    email = serializers.EmailField()
    participant_name = serializers.CharField()
    organization = serializers.CharField()
    phone = serializers.CharField()
    status = serializers.CharField()
    display_category = serializers.CharField()
    source = serializers.CharField()
    waitlist_position = serializers.IntegerField(allow_null=True)
    notification_status = serializers.CharField()
    check_in_token = serializers.CharField()
    confirmed_at = serializers.DateTimeField(allow_null=True)
    cancelled_at = serializers.DateTimeField(allow_null=True)
    deleted_at = serializers.DateTimeField(allow_null=True)
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()


class ParticipantBadgeSerializer(serializers.Serializer):
    event_title = serializers.CharField()
    participant_name = serializers.CharField()
    display_category = serializers.CharField()
    check_in_token = serializers.CharField()
    qr_payload = serializers.CharField(required=False)
    fields = serializers.ListField(child=serializers.CharField())


class ParticipantListSerializer(serializers.Serializer):
    summary = RegistrationSummarySerializer()
    count = serializers.IntegerField()
    page = serializers.IntegerField()
    page_size = serializers.IntegerField()
    results = ParticipantAdminSerializer(many=True)


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


def _domain_error(error):
    if isinstance(error, RegistrationClosed):
        raise ValidationError({"non_field_errors": [str(error)]}) from error
    if isinstance(error, RegistrationFull):
        raise Conflict(str(error)) from error
    if isinstance(error, RegistrationDuplicate):
        raise Conflict(str(error)) from error
    if isinstance(error, RegistrationNotFound):
        raise NotFound(str(error)) from error
    if isinstance(error, DomainValidationError):
        if hasattr(error, "message_dict"):
            raise ValidationError(error.message_dict) from error
        raise ValidationError({"non_field_errors": error.messages}) from error
    raise error


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
        event = public_event(request, slug)
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
        except Exception as error:
            _domain_error(error)
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
        event = public_event(request, slug)
        payload = RegistrationCancelInput(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            row = cancel_registration(
                event=event,
                email=payload.validated_data["email"],
                token=payload.validated_data["token"],
            )
        except Exception as error:
            _domain_error(error)
        return Response(serialize_registration(row, public=True))


class SiteEventRegistrations(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_registrations_list",
        tags=["Event Participants"],
        responses={200: ParticipantListSerializer},
        parameters=[
            OpenApiParameter("status", str),
            OpenApiParameter("category", str),
            OpenApiParameter("search", str),
            OpenApiParameter("page", int),
            OpenApiParameter("page_size", int),
        ],
        description=(
            "Site-scoped participant inventory with pagination, search, and status/category filters. "
            "Requires Site Administrator Events permission. Private contact fields are never public."
        ),
    )
    def get(self, request, site_pk, event_id):
        _site, event = admin_event(request, site_pk, event_id)
        try:
            page = int(request.query_params.get("page") or 1)
            page_size = int(request.query_params.get("page_size") or 25)
        except (TypeError, ValueError):
            raise ValidationError({"page": ["Provide integer page and page_size."]}) from None
        payload = list_participants(
            event,
            status=request.query_params.get("status", ""),
            category=request.query_params.get("category", ""),
            search=request.query_params.get("search", ""),
            page=page,
            page_size=page_size,
        )
        response = Response(payload)
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(
        operation_id="v1_sites_events_registrations_create",
        tags=["Event Participants"],
        request=AdminParticipantCreateInput,
        responses={201: ParticipantAdminSerializer},
        description=(
            "Manually invite (INVITED) or register (CONFIRMED/WAITLISTED) a participant "
            "without creating a CMS account. Display category is independent of speaker profiles."
        ),
    )
    def post(self, request, site_pk, event_id):
        _site, event = admin_event(request, site_pk, event_id)
        payload = AdminParticipantCreateInput(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            row = admin_create_participant(event, payload.validated_data)
        except Exception as error:
            _domain_error(error)
        response = Response(serialize_registration(row, public=False), status=201)
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventRegistrationDetail(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_registrations_retrieve",
        tags=["Event Participants"],
        responses={200: ParticipantAdminSerializer},
    )
    def get(self, request, site_pk, event_id, registration_id):
        site, event = admin_event(request, site_pk, event_id)
        row = owned_child(
            EventRegistration, pk=registration_id, event=event, deleted_at__isnull=True,
        )
        response = Response(serialize_registration(row, public=False))
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(
        operation_id="v1_sites_events_registrations_partial_update",
        tags=["Event Participants"],
        request=AdminParticipantUpdateInput,
        responses={200: ParticipantAdminSerializer},
    )
    def patch(self, request, site_pk, event_id, registration_id):
        _site, event = admin_event(request, site_pk, event_id)
        payload = AdminParticipantUpdateInput(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            row = admin_update_participant(event, registration_id, payload.validated_data)
        except Exception as error:
            _domain_error(error)
        response = Response(serialize_registration(row, public=False))
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(
        operation_id="v1_sites_events_registrations_action",
        tags=["Event Participants"],
        request=AdminParticipantActionInput,
        responses={200: ParticipantAdminSerializer},
        description="confirm / cancel / soft-delete. Soft-delete retains the row for audit retention.",
    )
    def post(self, request, site_pk, event_id, registration_id):
        _site, event = admin_event(request, site_pk, event_id)
        payload = AdminParticipantActionInput(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            row = admin_set_status(event, registration_id, action=payload.validated_data["action"])
        except Exception as error:
            _domain_error(error)
        response = Response(serialize_registration(row, public=False))
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventRegistrationBadge(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_registrations_badge",
        tags=["Event Participants"],
        responses={200: ParticipantBadgeSerializer},
        description=(
            "Printable badge layout fields: Event title, display name, category, opaque check-in token, "
            "and signed qr_payload. Reprint returns the same tokens and does not create a new registration."
        ),
    )
    def get(self, request, site_pk, event_id, registration_id):
        site, event = admin_event(request, site_pk, event_id)
        row = owned_child(
            EventRegistration, pk=registration_id, event=event, deleted_at__isnull=True,
        )
        record_event(
            action="EVENT_PARTICIPANT_BADGE_VIEWED",
            entity_type="cms.event_registration",
            entity_id=row.pk,
            after={"event": str(event.pk), "site": site.pk},
            changed_fields=[],
        )
        from apps.cms.api.event_attendance import enhance_badge
        response = Response(enhance_badge(event, row))
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventRegistrationsExport(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_registrations_export",
        tags=["Event Participants"],
        responses={200: {"description": "text/csv attachment"}},
        description=(
            "CSV export of explicitly approved fields only. Spreadsheet formula injection is neutralized. "
            "Exports are audit-logged. Soft-deleted rows are excluded."
        ),
    )
    def get(self, request, site_pk, event_id):
        site, event = admin_event(request, site_pk, event_id)
        filename, content = build_participants_csv(event)
        record_event(
            action="EVENT_PARTICIPANT_CSV_EXPORTED",
            entity_type="cms.event",
            entity_id=event.pk,
            after={"filename": filename, "bytes": len(content), "site": site.pk},
            changed_fields=[],
        )
        response = HttpResponse(content, content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        response["Cache-Control"] = "private, no-store"
        return response
