"""Site Admin Event updates and public notices feed."""
from __future__ import annotations

from django.core.exceptions import ValidationError as DomainValidationError
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.cms.event_domain import public_events_for_site, require_events_admin
from apps.cms.event_models import Event
from apps.cms.event_update_domain import (
    PUBLIC_UPDATES_MAX_AGE,
    UpdateConflict,
    UpdateNotFound,
    create_update,
    list_admin_updates,
    list_public_notices,
    list_public_updates,
    public_updates_etag,
    serialize_update,
    set_update_status,
    update_update,
)
from apps.cms.event_update_models import EventSessionRevision, UpdateSeverity, UpdateStatus
from apps.cms.event_session_models import EventSession
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


class EventUpdateSerializer(StrictFields, serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    event = serializers.UUIDField(read_only=True)
    title = serializers.CharField(required=False, max_length=255)
    body = serializers.CharField(required=False, allow_blank=True)
    severity = serializers.ChoiceField(choices=UpdateSeverity.choices, required=False)
    status = serializers.ChoiceField(choices=UpdateStatus.choices, read_only=True)
    pinned = serializers.BooleanField(required=False)
    published_at = serializers.DateTimeField(read_only=True, allow_null=True)
    unpublished_at = serializers.DateTimeField(read_only=True, allow_null=True)
    version = serializers.IntegerField(read_only=True)
    created_by = serializers.IntegerField(read_only=True, allow_null=True)
    updated_by = serializers.IntegerField(read_only=True, allow_null=True)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)


class EventUpdateCreateSerializer(StrictFields, serializers.Serializer):
    title = serializers.CharField(max_length=255)
    body = serializers.CharField(required=False, allow_blank=True)
    severity = serializers.ChoiceField(choices=UpdateSeverity.choices, required=False)
    pinned = serializers.BooleanField(required=False, default=False)


class EventUpdateActionSerializer(StrictFields, serializers.Serializer):
    action = serializers.ChoiceField(choices=["publish", "unpublish"])
    version = serializers.IntegerField(required=False, min_value=1)


class PublicUpdateSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    title = serializers.CharField()
    body = serializers.CharField()
    severity = serializers.CharField()
    pinned = serializers.BooleanField()
    published_at = serializers.DateTimeField(allow_null=True)
    updated_at = serializers.DateTimeField()


class SessionRevisionSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    session = serializers.UUIDField()
    session_version = serializers.IntegerField()
    before = serializers.DictField()
    after = serializers.DictField()
    changed_fields = serializers.ListField(child=serializers.CharField())
    actor = serializers.IntegerField(allow_null=True)
    created_at = serializers.DateTimeField()


def _domain_error(error):
    if isinstance(error, UpdateConflict):
        raise Conflict(str(error)) from error
    if isinstance(error, UpdateNotFound):
        raise NotFound(str(error)) from error
    if isinstance(error, DomainValidationError):
        if hasattr(error, "message_dict"):
            raise ValidationError(error.message_dict) from error
        raise ValidationError({"non_field_errors": error.messages}) from error
    raise error


def _admin_event(request, site_pk, event_id) -> tuple[Site, Event]:
    site = get_object_or_404(Site, pk=site_pk)
    if not module_is_available(site.pk, EVENTS_MODULE_CODE):
        raise PermissionDenied("Events are not enabled for this Site.")
    require_events_admin(request.user, site)
    event = get_object_or_404(Event, pk=event_id, site_id=site.pk)
    return site, event


def _public_event(request, slug) -> Event:
    site = getattr(request, "site", None)
    if site is None or not module_is_available(site.pk, EVENTS_MODULE_CODE):
        raise NotFound("Events are not available for this Site.")
    rows = public_events_for_site(site).filter(slug=slug)
    event = rows.filter(site_id=site.pk).first() or rows.first()
    if event is None:
        raise NotFound("Event not found.")
    return event


class SiteEventUpdates(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_updates_list",
        tags=["Event Updates"],
        responses={200: EventUpdateSerializer(many=True)},
    )
    def get(self, request, site_pk, event_id):
        _site, event = _admin_event(request, site_pk, event_id)
        response = Response(list_admin_updates(event))
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(
        operation_id="v1_sites_events_updates_create",
        tags=["Event Updates"],
        request=EventUpdateCreateSerializer,
        responses={201: EventUpdateSerializer},
        description="Create a draft Event notice. Does not send email/SMS/push.",
    )
    def post(self, request, site_pk, event_id):
        _site, event = _admin_event(request, site_pk, event_id)
        payload = EventUpdateCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            row = create_update(event, payload.validated_data, actor=request.user)
        except Exception as error:
            _domain_error(error)
        response = Response(serialize_update(row, public=False), status=201)
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventUpdateDetail(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_updates_partial_update",
        tags=["Event Updates"],
        request=EventUpdateSerializer,
        responses={200: EventUpdateSerializer},
    )
    def patch(self, request, site_pk, event_id, update_id):
        _site, event = _admin_event(request, site_pk, event_id)
        payload = EventUpdateSerializer(data=request.data, partial=True)
        payload.is_valid(raise_exception=True)
        expected = request.data.get("version")
        try:
            row = update_update(
                event,
                update_id,
                payload.validated_data,
                actor=request.user,
                expected_version=int(expected) if expected is not None else None,
            )
        except Exception as error:
            _domain_error(error)
        response = Response(serialize_update(row, public=False))
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventUpdateAction(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_updates_action",
        tags=["Event Updates"],
        request=EventUpdateActionSerializer,
        responses={200: EventUpdateSerializer},
        description=(
            "Publish or unpublish independently of the root Event. "
            "No email/SMS/push delivery is performed or claimed."
        ),
    )
    def post(self, request, site_pk, event_id, update_id):
        _site, event = _admin_event(request, site_pk, event_id)
        payload = EventUpdateActionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            row = set_update_status(
                event,
                update_id,
                action=payload.validated_data["action"],
                actor=request.user,
                expected_version=payload.validated_data.get("version"),
            )
        except Exception as error:
            _domain_error(error)
        response = Response(serialize_update(row, public=False))
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventSessionRevisions(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_session_revisions_list",
        tags=["Event Updates"],
        responses={200: SessionRevisionSerializer(many=True)},
    )
    def get(self, request, site_pk, event_id, session_id):
        _site, event = _admin_event(request, site_pk, event_id)
        session = get_object_or_404(EventSession, pk=session_id, event_id=event.pk)
        rows = EventSessionRevision.objects.filter(
            session_id=session.pk, event_id=event.pk,
        ).order_by("-created_at", "-session_version")[:100]
        payload = [
            {
                "id": row.pk,
                "session": row.session_id,
                "session_version": row.session_version,
                "before": row.before,
                "after": row.after,
                "changed_fields": row.changed_fields,
                "actor": row.actor_id,
                "created_at": row.created_at,
            }
            for row in rows
        ]
        response = Response(payload)
        response["Cache-Control"] = "private, no-store"
        return response


class PublicSiteEventUpdates(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = f"public, max-age={PUBLIC_UPDATES_MAX_AGE}, must-revalidate"
        response["Vary"] = "Host, Origin"
        return response

    @extend_schema(
        operation_id="v1_site_context_events_updates_list",
        tags=["Public Events"],
        responses={200: PublicUpdateSerializer(many=True)},
        description=(
            f"Published updates only. Freshness target: revalidate within {PUBLIC_UPDATES_MAX_AGE}s. "
            "Draft/unpublished updates are never returned."
        ),
    )
    def get(self, request, slug):
        event = _public_event(request, slug)
        response = Response(list_public_updates(event))
        response["ETag"] = public_updates_etag(event)
        response["X-Events-Cache-Scope"] = f"site-{event.site_id}-event-{event.slug}-updates"
        response["X-Events-Cache-Section"] = "updates"
        response["X-Events-Cache-Freshness-Seconds"] = str(PUBLIC_UPDATES_MAX_AGE)
        return response


class PublicSiteEventNotices(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = f"public, max-age={PUBLIC_UPDATES_MAX_AGE}, must-revalidate"
        response["Vary"] = "Host, Origin"
        return response

    @extend_schema(
        operation_id="v1_site_context_events_notices_list",
        tags=["Public Events"],
        responses={200: PublicUpdateSerializer(many=True)},
        description="Pinned and high-priority published notices for Overview prominence.",
    )
    def get(self, request, slug):
        event = _public_event(request, slug)
        response = Response(list_public_notices(event))
        response["ETag"] = public_updates_etag(event)
        response["X-Events-Cache-Section"] = "notices"
        response["X-Events-Cache-Freshness-Seconds"] = str(PUBLIC_UPDATES_MAX_AGE)
        return response
