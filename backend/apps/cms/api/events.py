"""Authenticated Event CRUD and publication APIs."""
from __future__ import annotations

from django.core.exceptions import ValidationError as DomainValidationError
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.api.models import Category
from apps.cms.event_domain import (
    EventConflict,
    EventPreconditionRequired,
    archive_event,
    cancel_event,
    create_event,
    duplicate_event,
    event_etag,
    public_events_queryset,
    publish_event,
    require_events_admin,
    update_event,
)
from apps.cms.event_models import Event, EventFormat, EventLifecycle, EventStatus
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


class EventSerializer(StrictFields, serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    site = serializers.IntegerField(read_only=True)
    title = serializers.CharField(required=False, allow_blank=True, max_length=255)
    slug = serializers.SlugField(required=False, allow_blank=True, max_length=255)
    summary = serializers.CharField(required=False, allow_blank=True, max_length=500)
    description = serializers.CharField(required=False, allow_blank=True)
    category = serializers.UUIDField(required=False, allow_null=True)
    organizer_name = serializers.CharField(required=False, allow_blank=True, max_length=255)
    organizer_email = serializers.EmailField(required=False, allow_blank=True)
    organizer_phone = serializers.CharField(required=False, allow_blank=True, max_length=64)
    status = serializers.ChoiceField(choices=EventStatus.choices, read_only=True)
    lifecycle = serializers.ChoiceField(choices=EventLifecycle.choices, read_only=True)
    starts_at = serializers.DateTimeField(required=False, allow_null=True)
    ends_at = serializers.DateTimeField(required=False, allow_null=True)
    timezone = serializers.CharField(required=False, allow_blank=True, max_length=64)
    venue = serializers.CharField(required=False, allow_blank=True, max_length=255)
    format = serializers.ChoiceField(choices=EventFormat.choices, required=False)
    online_url = serializers.CharField(required=False, allow_blank=True, max_length=2048)
    banner_asset = serializers.UUIDField(required=False, allow_null=True)
    banner_url = serializers.CharField(read_only=True, allow_null=True)
    registration_required = serializers.BooleanField(required=False)
    registration_capacity = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    registration_open = serializers.BooleanField(read_only=True)
    accepts_registration = serializers.BooleanField(read_only=True)
    cancellation_notice = serializers.CharField(required=False, allow_blank=True)
    published_at = serializers.DateTimeField(read_only=True, allow_null=True)
    cancelled_at = serializers.DateTimeField(read_only=True, allow_null=True)
    version = serializers.IntegerField(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)


class EventListResponse(serializers.Serializer):
    count = serializers.IntegerField()
    next = serializers.URLField(allow_null=True)
    previous = serializers.URLField(allow_null=True)
    results = EventSerializer(many=True)


class EventActionSerializer(StrictFields, serializers.Serializer):
    notice = serializers.CharField(required=False, allow_blank=True, max_length=2000)


class EventPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


def _banner_url(event: Event) -> str | None:
    if not event.banner_asset_id:
        return None
    return f"/api/v1/sites/{event.site_id}/assets/{event.banner_asset_id}/image/?variant=display"


def serialize_event(event: Event) -> dict:
    return {
        "id": event.pk,
        "site": event.site_id,
        "title": event.title,
        "slug": event.slug,
        "summary": event.summary,
        "description": event.description,
        "category": event.category_id,
        "organizer_name": event.organizer_name,
        "organizer_email": event.organizer_email,
        "organizer_phone": event.organizer_phone,
        "status": event.status,
        "lifecycle": event.derived_lifecycle(),
        "starts_at": event.starts_at,
        "ends_at": event.ends_at,
        "timezone": event.timezone,
        "venue": event.venue,
        "format": event.format,
        "online_url": event.online_url,
        "banner_asset": event.banner_asset_id,
        "banner_url": _banner_url(event),
        "registration_required": event.registration_required,
        "registration_capacity": event.registration_capacity,
        "registration_open": event.registration_open,
        "accepts_registration": event.accepts_registration,
        "cancellation_notice": event.cancellation_notice,
        "published_at": event.published_at,
        "cancelled_at": event.cancelled_at,
        "version": event.version,
        "created_at": event.created_at,
        "updated_at": event.updated_at,
    }


def _site(site_pk: int) -> Site:
    site = get_object_or_404(Site, pk=site_pk)
    if not module_is_available(site.pk, EVENTS_MODULE_CODE):
        raise PermissionDenied("Events are not enabled for this Site.")
    return site


class SiteEvents(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_list",
        tags=["Events"],
        responses={200: EventListResponse},
        parameters=[
            OpenApiParameter("search", str),
            OpenApiParameter("status", str, enum=EventStatus.values),
            OpenApiParameter("category", str),
            OpenApiParameter("date_from", str),
            OpenApiParameter("date_to", str),
            OpenApiParameter("lifecycle", str, enum=EventLifecycle.values),
            OpenApiParameter("page", int),
            OpenApiParameter("page_size", int),
        ],
    )
    def get(self, request, site_pk):
        site = _site(site_pk)
        require_events_admin(request.user, site)
        rows = Event.objects.filter(site_id=site.pk).select_related("category", "banner_asset")
        search = request.query_params.get("search", "").strip()
        status = request.query_params.get("status")
        category = request.query_params.get("category")
        date_from = request.query_params.get("date_from")
        date_to = request.query_params.get("date_to")
        lifecycle = request.query_params.get("lifecycle")
        if search:
            rows = rows.filter(Q(title__icontains=search) | Q(summary__icontains=search) | Q(slug__icontains=search))
        if status:
            rows = rows.filter(status=status)
        if category:
            rows = rows.filter(category_id=category)
        if date_from:
            rows = rows.filter(starts_at__date__gte=date_from)
        if date_to:
            rows = rows.filter(starts_at__date__lte=date_to)
        rows = rows.order_by("-starts_at", "-updated_at", "id")
        if lifecycle:
            now = timezone.now()
            if lifecycle == EventLifecycle.UPCOMING:
                rows = rows.filter(starts_at__gt=now)
            elif lifecycle == EventLifecycle.IN_PROGRESS:
                rows = rows.filter(starts_at__lte=now, ends_at__gte=now)
            elif lifecycle == EventLifecycle.PAST:
                rows = rows.filter(ends_at__lt=now)
            elif lifecycle == EventLifecycle.UNKNOWN:
                rows = rows.filter(Q(starts_at__isnull=True) | Q(ends_at__isnull=True))
        paginator = EventPagination()
        page = paginator.paginate_queryset(rows, request, view=self)
        return paginator.get_paginated_response([serialize_event(row) for row in page])

    @extend_schema(operation_id="v1_sites_events_create", tags=["Events"], request=EventSerializer, responses={201: EventSerializer})
    def post(self, request, site_pk):
        site = _site(site_pk)
        serializer = EventSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with translate_domain_errors():
            event = create_event(site, serializer.validated_data, actor=request.user)
        response = Response(serialize_event(event), status=201)
        response["ETag"] = event_etag(event)
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventDetail(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    def _load(self, request, site_pk, event_id) -> Event:
        site = _site(site_pk)
        require_events_admin(request.user, site)
        return get_object_or_404(Event, pk=event_id, site_id=site.pk)

    @extend_schema(operation_id="v1_sites_events_retrieve", tags=["Events"], responses={200: EventSerializer})
    def get(self, request, site_pk, event_id):
        event = self._load(request, site_pk, event_id)
        response = Response(serialize_event(event))
        response["ETag"] = event_etag(event)
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(operation_id="v1_sites_events_partial_update", tags=["Events"], request=EventSerializer, responses={200: EventSerializer})
    def patch(self, request, site_pk, event_id):
        event = self._load(request, site_pk, event_id)
        serializer = EventSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        with translate_domain_errors():
            try:
                event = update_event(
                    event, serializer.validated_data, actor=request.user,
                    expected=request.headers.get("If-Match"),
                )
            except EventPreconditionRequired as error:
                raise PreconditionRequired() from error
            except EventConflict as error:
                raise PreconditionFailed() from error
        response = Response(serialize_event(event))
        response["ETag"] = event_etag(event)
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventAction(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    http_method_names = ["post", "head", "options"]

    @extend_schema(operation_id="v1_sites_events_action", tags=["Events"], request=EventActionSerializer, responses={200: EventSerializer})
    def post(self, request, site_pk, event_id, action):
        site = _site(site_pk)
        require_events_admin(request.user, site)
        event = get_object_or_404(Event, pk=event_id, site_id=site.pk)
        expected = request.headers.get("If-Match")
        serializer = EventActionSerializer(data=request.data or {})
        serializer.is_valid(raise_exception=True)
        with translate_domain_errors():
            try:
                if action == "publish":
                    event = publish_event(event, actor=request.user, expected=expected)
                elif action == "cancel":
                    event = cancel_event(
                        event, actor=request.user, expected=expected,
                        notice=serializer.validated_data.get("notice", ""),
                    )
                elif action == "archive":
                    event = archive_event(event, actor=request.user, expected=expected)
                elif action == "duplicate":
                    event = duplicate_event(event, actor=request.user)
                else:
                    raise NotFound("Unknown Event action.")
            except EventPreconditionRequired as error:
                raise PreconditionRequired() from error
            except EventConflict as error:
                raise PreconditionFailed() from error
        response = Response(serialize_event(event), status=201 if action == "duplicate" else 200)
        response["ETag"] = event_etag(event)
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventPreview(APIView):
    """Authenticated preview; never served on anonymous public routes."""

    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(operation_id="v1_sites_events_preview", tags=["Events"], responses={200: EventSerializer})
    def get(self, request, site_pk, event_id):
        site = _site(site_pk)
        require_events_admin(request.user, site)
        event = get_object_or_404(Event, pk=event_id, site_id=site.pk)
        payload = serialize_event(event)
        payload["preview"] = True
        response = Response(payload)
        response["Cache-Control"] = "private, no-store"
        return response


class PublicSiteEvents(APIView):
    authentication_classes = []
    permission_classes = []

    @extend_schema(operation_id="v1_site_context_events_list", tags=["Public Events"], responses={200: EventListResponse})
    def get(self, request):
        site = getattr(request, "site", None)
        if site is None or not module_is_available(site.pk, EVENTS_MODULE_CODE):
            raise NotFound("Events are not available for this Site.")
        rows = public_events_queryset(site.pk).select_related("banner_asset")
        search = request.query_params.get("search", "").strip()
        if search:
            rows = rows.filter(Q(title__icontains=search) | Q(summary__icontains=search))
        rows = rows.order_by("starts_at", "id")
        paginator = EventPagination()
        page = paginator.paginate_queryset(rows, request, view=self)
        return paginator.get_paginated_response([serialize_event(row) for row in page])


class PublicSiteEventDetail(APIView):
    authentication_classes = []
    permission_classes = []

    @extend_schema(operation_id="v1_site_context_events_retrieve", tags=["Public Events"], responses={200: EventSerializer})
    def get(self, request, slug):
        site = getattr(request, "site", None)
        if site is None or not module_is_available(site.pk, EVENTS_MODULE_CODE):
            raise NotFound("Events are not available for this Site.")
        event = public_events_queryset(site.pk).filter(slug=slug).select_related("banner_asset").first()
        if event is None:
            raise NotFound("Event not found.")
        return Response(serialize_event(event))
