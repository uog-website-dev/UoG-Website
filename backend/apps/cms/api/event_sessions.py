"""Site-scoped Event session schedule APIs and public agenda."""
from __future__ import annotations

from django.db.models import Q
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.cms.event_domain import event_etag, public_events_for_site, require_events_admin
from apps.cms.event_models import Event
from apps.cms.event_session_domain import (
    SessionConflict,
    SessionPreconditionRequired,
    active_sessions,
    create_session,
    detect_session_conflicts,
    duplicate_session,
    public_agenda,
    remove_session,
    reorder_sessions,
    serialize_session,
    session_etag,
    update_session,
)
from apps.cms.event_session_models import EventSession, SessionStatus, SessionType, SessionVisibility
from apps.sites.api.access import PreconditionFailed, PreconditionRequired, translate_domain_errors
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


class EventSessionSerializer(StrictFields, serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    event = serializers.UUIDField(read_only=True)
    day_date = serializers.DateField(required=False, allow_null=True)
    starts_at = serializers.DateTimeField(required=False)
    ends_at = serializers.DateTimeField(required=False)
    title = serializers.CharField(required=False, allow_blank=True, max_length=255)
    description = serializers.CharField(required=False, allow_blank=True)
    session_type = serializers.ChoiceField(choices=SessionType.choices, required=False)
    venue_room = serializers.CharField(required=False, allow_blank=True, max_length=255)
    track = serializers.CharField(required=False, allow_blank=True, max_length=120)
    sort_order = serializers.IntegerField(required=False, min_value=0)
    visibility = serializers.ChoiceField(choices=SessionVisibility.choices, required=False)
    status = serializers.ChoiceField(choices=SessionStatus.choices, required=False)
    public_notes = serializers.CharField(required=False, allow_blank=True)
    speaker_labels = serializers.ListField(
        child=serializers.CharField(max_length=255), required=False,
    )
    media_asset = serializers.UUIDField(required=False, allow_null=True)
    document = serializers.UUIDField(required=False, allow_null=True)
    version = serializers.IntegerField(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)
    removed_at = serializers.DateTimeField(read_only=True, allow_null=True)
    conflicts = serializers.DictField(read_only=True, required=False)


class EventSessionReorderSerializer(StrictFields, serializers.Serializer):
    order = serializers.ListField(child=serializers.UUIDField(), allow_empty=True)


class EventSessionListResponse(serializers.Serializer):
    results = EventSessionSerializer(many=True)
    conflicts = serializers.DictField()


class PublicAgendaDaySerializer(serializers.Serializer):
    date = serializers.DateField()
    tracks = serializers.ListField(child=serializers.DictField())


def _site(site_pk: int) -> Site:
    site = get_object_or_404(Site, pk=site_pk)
    if not module_is_available(site.pk, EVENTS_MODULE_CODE):
        raise PermissionDenied("Events are not enabled for this Site.")
    return site


def _load_event(request, site_pk, event_id) -> Event:
    site = _site(site_pk)
    require_events_admin(request.user, site)
    return get_object_or_404(Event, pk=event_id, site_id=site.pk)


def _load_session(request, site_pk, event_id, session_id) -> EventSession:
    event = _load_event(request, site_pk, event_id)
    return get_object_or_404(EventSession, pk=session_id, event_id=event.pk)


def _admin_payload(session: EventSession, event: Event) -> dict:
    conflicts = detect_session_conflicts(event, candidate=session)
    return serialize_session(session, public=False, conflicts=conflicts)


class SiteEventSessions(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_event_sessions_list",
        tags=["Event Sessions"],
        responses={200: EventSessionListResponse},
        parameters=[OpenApiParameter("search", str), OpenApiParameter("day", str)],
    )
    def get(self, request, site_pk, event_id):
        event = _load_event(request, site_pk, event_id)
        rows = active_sessions(event)
        search = request.query_params.get("search", "").strip()
        day = request.query_params.get("day", "").strip()
        if search:
            rows = rows.filter(
                Q(title__icontains=search)
                | Q(venue_room__icontains=search)
                | Q(track__icontains=search)
                | Q(public_notes__icontains=search)
            )
        if day:
            rows = rows.filter(day_date=day)
        rows = rows.order_by("day_date", "sort_order", "starts_at", "id")
        conflicts = detect_session_conflicts(event)
        return Response({
            "results": [serialize_session(row, public=False, conflicts=conflicts) for row in rows],
            "conflicts": conflicts,
        })

    @extend_schema(
        operation_id="v1_sites_event_sessions_create",
        tags=["Event Sessions"],
        request=EventSessionSerializer,
        responses={201: EventSessionSerializer},
    )
    def post(self, request, site_pk, event_id):
        event = _load_event(request, site_pk, event_id)
        serializer = EventSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with translate_domain_errors():
            session = create_session(event, serializer.validated_data, actor=request.user)
        response = Response(_admin_payload(session, event), status=201)
        response["ETag"] = session_etag(session)
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventSessionDetail(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_event_sessions_retrieve",
        tags=["Event Sessions"],
        responses={200: EventSessionSerializer},
    )
    def get(self, request, site_pk, event_id, session_id):
        session = _load_session(request, site_pk, event_id, session_id)
        if session.removed_at is not None:
            raise NotFound("Session not found.")
        response = Response(_admin_payload(session, session.event))
        response["ETag"] = session_etag(session)
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(
        operation_id="v1_sites_event_sessions_partial_update",
        tags=["Event Sessions"],
        request=EventSessionSerializer,
        responses={200: EventSessionSerializer},
    )
    def patch(self, request, site_pk, event_id, session_id):
        session = _load_session(request, site_pk, event_id, session_id)
        serializer = EventSessionSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        with translate_domain_errors():
            try:
                session = update_session(
                    session, serializer.validated_data, actor=request.user,
                    expected=request.headers.get("If-Match"),
                )
            except SessionPreconditionRequired as error:
                raise PreconditionRequired() from error
            except SessionConflict as error:
                raise PreconditionFailed() from error
        response = Response(_admin_payload(session, session.event))
        response["ETag"] = session_etag(session)
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(
        operation_id="v1_sites_event_sessions_destroy",
        tags=["Event Sessions"],
        responses={200: EventSessionSerializer},
    )
    def delete(self, request, site_pk, event_id, session_id):
        session = _load_session(request, site_pk, event_id, session_id)
        with translate_domain_errors():
            try:
                session = remove_session(
                    session, actor=request.user, expected=request.headers.get("If-Match"),
                )
            except SessionPreconditionRequired as error:
                raise PreconditionRequired() from error
            except SessionConflict as error:
                raise PreconditionFailed() from error
        response = Response(serialize_session(session, public=False))
        response["ETag"] = session_etag(session)
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventSessionAction(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    http_method_names = ["post", "head", "options"]

    @extend_schema(
        operation_id="v1_sites_event_sessions_action",
        tags=["Event Sessions"],
        request=None,
        responses={201: EventSessionSerializer},
    )
    def post(self, request, site_pk, event_id, session_id, action):
        session = _load_session(request, site_pk, event_id, session_id)
        if session.removed_at is not None:
            raise NotFound("Session not found.")
        with translate_domain_errors():
            if action == "duplicate":
                created = duplicate_session(session, actor=request.user)
            else:
                raise NotFound("Unknown session action.")
        response = Response(_admin_payload(created, created.event), status=201)
        response["ETag"] = session_etag(created)
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventSessionsReorder(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    http_method_names = ["post", "head", "options"]

    @extend_schema(
        operation_id="v1_sites_event_sessions_reorder",
        tags=["Event Sessions"],
        request=EventSessionReorderSerializer,
        responses={200: EventSessionListResponse},
    )
    def post(self, request, site_pk, event_id):
        event = _load_event(request, site_pk, event_id)
        serializer = EventSessionReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with translate_domain_errors():
            try:
                rows = reorder_sessions(
                    event,
                    [str(value) for value in serializer.validated_data["order"]],
                    actor=request.user,
                    expected_event_etag=request.headers.get("If-Match"),
                )
            except SessionPreconditionRequired as error:
                raise PreconditionRequired() from error
            except SessionConflict as error:
                raise PreconditionFailed() from error
        conflicts = detect_session_conflicts(event)
        response = Response({
            "results": [serialize_session(row, public=False, conflicts=conflicts) for row in rows],
            "conflicts": conflicts,
        })
        response["ETag"] = event_etag(event)
        response["Cache-Control"] = "private, no-store"
        return response


class PublicAgendaResponse(serializers.Serializer):
    event = serializers.UUIDField()
    slug = serializers.SlugField()
    days = PublicAgendaDaySerializer(many=True)


class PublicSiteEventAgenda(APIView):
    authentication_classes = []
    permission_classes = []

    @extend_schema(
        operation_id="v1_site_context_events_agenda",
        tags=["Public Events"],
        responses={200: PublicAgendaResponse},
        description=(
            "Public multi-day agenda grouped by date and track. Session visibility and "
            "people publication are checked independently of Event root publication. "
            "Cache scope is section-specific so schedule updates do not require "
            "re-publishing the Event."
        ),
    )
    def get(self, request, slug):
        from apps.cms.event_session_domain import public_agenda_etag

        site = getattr(request, "site", None)
        if site is None or not module_is_available(site.pk, EVENTS_MODULE_CODE):
            raise NotFound("Events are not available for this Site.")
        rows = public_events_for_site(site).filter(slug=slug)
        event = rows.filter(site_id=site.pk).first() or rows.first()
        if event is None:
            raise NotFound("Event not found.")
        response = Response({"event": event.pk, "slug": event.slug, "days": public_agenda(event)})
        response["Cache-Control"] = "public, max-age=0, must-revalidate"
        response["Vary"] = "Host"
        response["ETag"] = public_agenda_etag(event)
        response["X-Events-Cache-Scope"] = f"site-{site.pk}-event-{event.slug}-agenda"
        response["X-Events-Cache-Section"] = "agenda"
        return response
