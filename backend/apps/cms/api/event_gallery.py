"""Site Admin Event gallery and public gallery listing."""
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
from apps.cms.event_gallery_domain import (
    GalleryConflict,
    GalleryNotFound,
    create_gallery_images,
    detach_gallery_image,
    list_admin_gallery,
    list_public_gallery,
    reorder_gallery,
    serialize_gallery_image,
    set_gallery_published,
    update_gallery_image,
)
from apps.cms.event_models import Event
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


class GalleryImageSerializer(StrictFields, serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    event = serializers.UUIDField(read_only=True)
    media_asset = serializers.UUIDField(required=False)
    session = serializers.UUIDField(required=False, allow_null=True)
    session_title = serializers.CharField(read_only=True, allow_null=True)
    caption = serializers.CharField(required=False, allow_blank=True, max_length=500)
    alt_text = serializers.CharField(required=False, allow_blank=True, max_length=255)
    sort_order = serializers.IntegerField(required=False, min_value=0)
    is_published = serializers.BooleanField(required=False)
    usage_consent = serializers.BooleanField(required=False)
    published_at = serializers.DateTimeField(read_only=True, allow_null=True)
    version = serializers.IntegerField(read_only=True)
    thumbnail_url = serializers.CharField(read_only=True)
    display_url = serializers.CharField(read_only=True)
    original_filename = serializers.CharField(read_only=True, required=False)
    content_type = serializers.CharField(read_only=True, required=False)
    byte_count = serializers.IntegerField(read_only=True, required=False)
    asset_ready = serializers.BooleanField(read_only=True, required=False)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)


class GalleryCreateItemSerializer(StrictFields, serializers.Serializer):
    media_asset = serializers.UUIDField()
    caption = serializers.CharField(required=False, allow_blank=True, max_length=500)
    alt_text = serializers.CharField(required=False, allow_blank=True, max_length=255)
    session = serializers.UUIDField(required=False, allow_null=True)
    is_published = serializers.BooleanField(required=False, default=False)
    usage_consent = serializers.BooleanField()


class GalleryCreateSerializer(StrictFields, serializers.Serializer):
    items = GalleryCreateItemSerializer(many=True)


class GalleryReorderSerializer(StrictFields, serializers.Serializer):
    order = serializers.ListField(child=serializers.UUIDField(), allow_empty=True)
    versions = serializers.DictField(
        child=serializers.IntegerField(min_value=1), required=False,
    )


class GalleryPublishSerializer(StrictFields, serializers.Serializer):
    is_published = serializers.BooleanField()
    version = serializers.IntegerField(required=False, min_value=1)


class PublicGalleryImageSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    session = serializers.UUIDField(allow_null=True)
    session_title = serializers.CharField(allow_null=True)
    caption = serializers.CharField()
    alt_text = serializers.CharField()
    sort_order = serializers.IntegerField()
    thumbnail_url = serializers.CharField()
    display_url = serializers.CharField()


def _domain_error(error):
    if isinstance(error, GalleryConflict):
        raise Conflict(str(error)) from error
    if isinstance(error, GalleryNotFound):
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


class SiteEventGallery(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_gallery_list",
        tags=["Event Gallery"],
        responses={200: GalleryImageSerializer(many=True)},
    )
    def get(self, request, site_pk, event_id):
        _site, event = _admin_event(request, site_pk, event_id)
        response = Response(list_admin_gallery(event))
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(
        operation_id="v1_sites_events_gallery_create",
        tags=["Event Gallery"],
        request=GalleryCreateSerializer,
        responses={201: GalleryImageSerializer(many=True)},
        description=(
            "Attach one or more Site Media Library images. Does not duplicate bytes. "
            "usage_consent is required. Quarantined/PENDING assets are rejected."
        ),
    )
    def post(self, request, site_pk, event_id):
        _site, event = _admin_event(request, site_pk, event_id)
        payload = GalleryCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            rows = create_gallery_images(event, payload.validated_data["items"], actor=request.user)
        except Exception as error:
            _domain_error(error)
        response = Response(
            [serialize_gallery_image(row, public=False) for row in rows],
            status=201,
        )
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventGalleryReorder(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_gallery_reorder",
        tags=["Event Gallery"],
        request=GalleryReorderSerializer,
        responses={200: GalleryImageSerializer(many=True)},
    )
    def post(self, request, site_pk, event_id):
        _site, event = _admin_event(request, site_pk, event_id)
        payload = GalleryReorderSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            rows = reorder_gallery(
                event,
                payload.validated_data["order"],
                actor=request.user,
                expected_versions=payload.validated_data.get("versions"),
            )
        except Exception as error:
            _domain_error(error)
        response = Response([serialize_gallery_image(row, public=False) for row in rows])
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventGalleryDetail(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_gallery_partial_update",
        tags=["Event Gallery"],
        request=GalleryImageSerializer,
        responses={200: GalleryImageSerializer},
    )
    def patch(self, request, site_pk, event_id, image_id):
        _site, event = _admin_event(request, site_pk, event_id)
        payload = GalleryImageSerializer(data=request.data, partial=True)
        payload.is_valid(raise_exception=True)
        expected = request.data.get("version")
        try:
            row = update_gallery_image(
                event,
                image_id,
                payload.validated_data,
                actor=request.user,
                expected_version=int(expected) if expected is not None else None,
            )
        except Exception as error:
            _domain_error(error)
        response = Response(serialize_gallery_image(row, public=False))
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(
        operation_id="v1_sites_events_gallery_destroy",
        tags=["Event Gallery"],
        description="Detach from the Event gallery. Canonical Site media is retained.",
    )
    def delete(self, request, site_pk, event_id, image_id):
        _site, event = _admin_event(request, site_pk, event_id)
        try:
            detach_gallery_image(event, image_id, actor=request.user)
        except Exception as error:
            _domain_error(error)
        return Response(status=204)


class SiteEventGalleryPublish(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_gallery_publish",
        tags=["Event Gallery"],
        request=GalleryPublishSerializer,
        responses={200: GalleryImageSerializer},
        description="Publish/unpublish independently of the root Event.",
    )
    def post(self, request, site_pk, event_id, image_id):
        _site, event = _admin_event(request, site_pk, event_id)
        payload = GalleryPublishSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            row = set_gallery_published(
                event,
                image_id,
                is_published=payload.validated_data["is_published"],
                actor=request.user,
                expected_version=payload.validated_data.get("version"),
            )
        except Exception as error:
            _domain_error(error)
        response = Response(serialize_gallery_image(row, public=False))
        response["Cache-Control"] = "private, no-store"
        return response


class PublicSiteEventGallery(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        # Short cache aligned with Event detail section discovery.
        response["Cache-Control"] = "public, max-age=60"
        response["Vary"] = "Host, Origin"
        return response

    @extend_schema(
        operation_id="v1_site_context_events_gallery_list",
        tags=["Public Events"],
        responses={200: PublicGalleryImageSerializer(many=True)},
    )
    def get(self, request, slug):
        event = _public_event(request, slug)
        return Response(list_public_gallery(event))
