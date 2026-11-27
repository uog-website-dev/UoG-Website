"""Site Admin attendance check-in and Event reports."""
from __future__ import annotations

from django.core.exceptions import ValidationError as DomainValidationError
from django.http import HttpResponse
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.audit.writer import record_event
from apps.cms.event_access import admin_event
from apps.cms.event_attendance_domain import (
    AttendanceForbidden,
    AttendanceNotFound,
    badge_qr_payload,
    build_report_csv,
    check_in_by_token,
    check_in_registration,
    check_out_registration,
    event_report,
    serialize_attendance,
)
from apps.cms.event_attendance_models import AttendanceMethod, EventAttendance
from apps.cms.event_registration_domain import serialize_badge
from apps.cms.event_registration_models import EventRegistration


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


class AttendanceSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    event = serializers.UUIDField()
    registration = serializers.UUIDField()
    checked_in_at = serializers.DateTimeField()
    checked_out_at = serializers.DateTimeField(allow_null=True)
    method = serializers.ChoiceField(choices=AttendanceMethod.choices)
    operator = serializers.IntegerField(allow_null=True)
    notes = serializers.CharField(allow_blank=True)
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()
    replayed = serializers.BooleanField(required=False)


class ManualCheckInInput(StrictFields, serializers.Serializer):
    registration_id = serializers.UUIDField()
    override = serializers.BooleanField(required=False, default=False)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=255)


class TokenCheckInInput(StrictFields, serializers.Serializer):
    token = serializers.CharField(max_length=512)
    override = serializers.BooleanField(required=False, default=False)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=255)


class ReportMetricsSerializer(serializers.Serializer):
    registrations = serializers.IntegerField()
    confirmed = serializers.IntegerField()
    waitlisted = serializers.IntegerField()
    cancelled = serializers.IntegerField()
    invited = serializers.IntegerField()
    attended = serializers.IntegerField()
    capacity = serializers.IntegerField(allow_null=True)
    seats_remaining = serializers.IntegerField(allow_null=True)
    capacity_utilization = serializers.FloatField(allow_null=True)


def _domain_error(error):
    if isinstance(error, AttendanceNotFound):
        raise NotFound(str(error)) from error
    if isinstance(error, AttendanceForbidden):
        raise PermissionDenied(str(error)) from error
    if isinstance(error, DomainValidationError):
        if hasattr(error, "message_dict"):
            raise ValidationError(error.message_dict) from error
        raise ValidationError({"non_field_errors": error.messages}) from error
    raise error


class SiteEventCheckIn(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_attendance_check_in",
        tags=["Event Attendance"],
        request=ManualCheckInInput,
        responses={200: AttendanceSerializer, 201: AttendanceSerializer},
        description=(
            "Manual check-in for a confirmed/invited participant. Idempotent: repeats return the "
            "existing attendance row without inflating totals. Cancelled participants require override=true."
        ),
    )
    def post(self, request, site_pk, event_id):
        _site, event = admin_event(request, site_pk, event_id)
        payload = ManualCheckInInput(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            row, created = check_in_registration(
                event,
                payload.validated_data["registration_id"],
                actor=request.user,
                override=payload.validated_data.get("override", False),
                notes=payload.validated_data.get("notes", ""),
            )
        except Exception as error:
            _domain_error(error)
        body = serialize_attendance(row)
        body["replayed"] = not created
        response = Response(body, status=201 if created else 200)
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventCheckInScan(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_attendance_scan",
        tags=["Event Attendance"],
        request=TokenCheckInInput,
        responses={200: AttendanceSerializer, 201: AttendanceSerializer},
        description=(
            "QR/token check-in. Accepts signed QR payload or opaque badge check_in_token. "
            "Other-Event or tampered tokens are rejected. Replays are idempotent."
        ),
    )
    def post(self, request, site_pk, event_id):
        _site, event = admin_event(request, site_pk, event_id)
        payload = TokenCheckInInput(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            row, created = check_in_by_token(
                event,
                payload.validated_data["token"],
                actor=request.user,
                override=payload.validated_data.get("override", False),
                notes=payload.validated_data.get("notes", ""),
            )
        except Exception as error:
            _domain_error(error)
        body = serialize_attendance(row)
        body["replayed"] = not created
        response = Response(body, status=201 if created else 200)
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventCheckOut(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_attendance_check_out",
        tags=["Event Attendance"],
        responses={200: AttendanceSerializer},
    )
    def post(self, request, site_pk, event_id, registration_id):
        _site, event = admin_event(request, site_pk, event_id)
        try:
            row = check_out_registration(event, registration_id, actor=request.user)
        except Exception as error:
            _domain_error(error)
        response = Response(serialize_attendance(row))
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventAttendanceList(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_attendance_list",
        tags=["Event Attendance"],
        responses={200: AttendanceSerializer(many=True)},
    )
    def get(self, request, site_pk, event_id):
        _site, event = admin_event(request, site_pk, event_id)
        rows = EventAttendance.objects.filter(event_id=event.pk).order_by("-checked_in_at", "id")[:500]
        response = Response([serialize_attendance(row) for row in rows])
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventReport(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_report",
        tags=["Event Reports"],
        parameters=[
            OpenApiParameter("status", str),
            OpenApiParameter("category", str),
            OpenApiParameter("attended", str),
            OpenApiParameter("date_from", str),
            OpenApiParameter("date_to", str),
        ],
        responses={200: serializers.DictField()},
        description=(
            "Private Site Admin metrics: registrations, confirmed, waitlisted, cancelled, attended, "
            "capacity utilization, and category breakdown. Not exposed on public Event APIs."
        ),
    )
    def get(self, request, site_pk, event_id):
        _site, event = admin_event(request, site_pk, event_id)
        try:
            payload = event_report(
                event,
                status=request.query_params.get("status", ""),
                category=request.query_params.get("category", ""),
                attended=request.query_params.get("attended", ""),
                date_from=request.query_params.get("date_from", ""),
                date_to=request.query_params.get("date_to", ""),
            )
        except Exception as error:
            _domain_error(error)
        response = Response(payload)
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventReportExport(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_report_export",
        tags=["Event Reports"],
        responses={200: {"description": "text/csv attachment"}},
        description="Privacy-controlled attendance report CSV with spreadsheet formula injection protection.",
    )
    def get(self, request, site_pk, event_id):
        site, event = admin_event(request, site_pk, event_id)
        try:
            filename, content = build_report_csv(
                event,
                status=request.query_params.get("status", ""),
                category=request.query_params.get("category", ""),
                attended=request.query_params.get("attended", ""),
                date_from=request.query_params.get("date_from", ""),
                date_to=request.query_params.get("date_to", ""),
            )
        except Exception as error:
            _domain_error(error)
        record_event(
            action="EVENT_ATTENDANCE_REPORT_EXPORTED",
            entity_type="cms.event",
            entity_id=event.pk,
            after={"filename": filename, "bytes": len(content), "site": site.pk},
            changed_fields=[],
        )
        response = HttpResponse(content, content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        response["Cache-Control"] = "private, no-store"
        return response


def enhance_badge(event: Event, row: EventRegistration) -> dict:
    payload = serialize_badge(event, row)
    payload["qr_payload"] = badge_qr_payload(event, row)
    return payload
