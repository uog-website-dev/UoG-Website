"""Site Admin Event resources and public download endpoints."""
from __future__ import annotations

from django.core.exceptions import ValidationError as DomainValidationError
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.cms.event_access import admin_event, public_event
from apps.cms.event_resource_access import (
    ResourceFileThrottle,
    authorize_resource_file,
    issue_download_grant,
    parse_file_query,
    resource_file_response,
    verify_registration_entitlement,
)
from apps.cms.event_resource_domain import (
    ResourceConflict,
    ResourceNotFound,
    create_resource,
    list_admin_resources,
    list_public_resources,
    remove_resource,
    reorder_resources,
    serialize_resource,
    set_resource_visibility,
    update_resource,
)
from apps.cms.event_resource_models import ResourceCategory, ResourceVisibility
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


class EventResourceSerializer(StrictFields, serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    event = serializers.UUIDField(read_only=True)
    session = serializers.UUIDField(required=False, allow_null=True)
    session_title = serializers.CharField(read_only=True, allow_null=True)
    document = serializers.UUIDField(required=False)
    document_title = serializers.CharField(read_only=True, required=False)
    title = serializers.CharField(required=False, max_length=255)
    description = serializers.CharField(required=False, allow_blank=True)
    category = serializers.ChoiceField(choices=ResourceCategory.choices, required=False)
    sort_order = serializers.IntegerField(required=False, min_value=0)
    visibility = serializers.ChoiceField(choices=ResourceVisibility.choices, required=False)
    published_at = serializers.DateTimeField(read_only=True, allow_null=True)
    file_type = serializers.CharField(read_only=True, allow_null=True)
    original_filename = serializers.CharField(read_only=True, allow_null=True)
    file_size = serializers.IntegerField(read_only=True, allow_null=True)
    file_ready = serializers.BooleanField(read_only=True)
    version = serializers.IntegerField(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)
    removed_at = serializers.DateTimeField(read_only=True, allow_null=True, required=False)


class EventResourceCreateSerializer(StrictFields, serializers.Serializer):
    document = serializers.UUIDField()
    title = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True)
    category = serializers.ChoiceField(choices=ResourceCategory.choices, required=False)
    session = serializers.UUIDField(required=False, allow_null=True)
    visibility = serializers.ChoiceField(choices=ResourceVisibility.choices, required=False)
    sort_order = serializers.IntegerField(required=False, min_value=0)


class EventResourceReorderSerializer(StrictFields, serializers.Serializer):
    order = serializers.ListField(child=serializers.UUIDField(), allow_empty=True)


class EventResourceVisibilitySerializer(StrictFields, serializers.Serializer):
    visibility = serializers.ChoiceField(choices=ResourceVisibility.choices)


class PublicResourceSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    session = serializers.UUIDField(allow_null=True)
    session_title = serializers.CharField(allow_null=True)
    title = serializers.CharField()
    description = serializers.CharField()
    category = serializers.CharField()
    sort_order = serializers.IntegerField()
    visibility = serializers.CharField()
    requires_registration = serializers.BooleanField()
    file_type = serializers.CharField(allow_null=True)
    original_filename = serializers.CharField(allow_null=True)
    file_size = serializers.IntegerField(allow_null=True)
    file_ready = serializers.BooleanField()
    download_path = serializers.CharField(allow_null=True)


class ResourceEntitlementInput(StrictFields, serializers.Serializer):
    email = serializers.EmailField()
    token = serializers.CharField(max_length=64)


class ResourceGrantSerializer(serializers.Serializer):
    grant = serializers.CharField()
    expires_in = serializers.IntegerField()
    expires_at = serializers.IntegerField()
    download_path = serializers.CharField()


def _domain_error(error):
    if isinstance(error, ResourceConflict):
        raise Conflict(str(error)) from error
    if isinstance(error, ResourceNotFound):
        raise NotFound(str(error)) from error
    if isinstance(error, DomainValidationError):
        if hasattr(error, "message_dict"):
            raise ValidationError(error.message_dict) from error
        raise ValidationError({"non_field_errors": error.messages}) from error
    raise error


class SiteEventResources(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_resources_list",
        tags=["Event Resources"],
        responses={200: EventResourceSerializer(many=True)},
    )
    def get(self, request, site_pk, event_id):
        _site, event = admin_event(request, site_pk, event_id)
        response = Response(list_admin_resources(event))
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(
        operation_id="v1_sites_events_resources_create",
        tags=["Event Resources"],
        request=EventResourceCreateSerializer,
        responses={201: EventResourceSerializer},
        description=(
            "Associate an existing Site-owned Document with the Event or a Session. "
            "Does not duplicate stored files. Document must pass READY/MIME/quarantine checks."
        ),
    )
    def post(self, request, site_pk, event_id):
        _site, event = admin_event(request, site_pk, event_id)
        payload = EventResourceCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            row = create_resource(event, payload.validated_data, actor=request.user)
        except Exception as error:
            _domain_error(error)
        response = Response(serialize_resource(row, public=False), status=201)
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventResourcesReorder(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_resources_reorder",
        tags=["Event Resources"],
        request=EventResourceReorderSerializer,
        responses={200: EventResourceSerializer(many=True)},
    )
    def post(self, request, site_pk, event_id):
        _site, event = admin_event(request, site_pk, event_id)
        payload = EventResourceReorderSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            rows = reorder_resources(event, payload.validated_data["order"], actor=request.user)
        except Exception as error:
            _domain_error(error)
        response = Response([serialize_resource(row, public=False) for row in rows])
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventResourceDetail(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_resources_partial_update",
        tags=["Event Resources"],
        request=EventResourceSerializer,
        responses={200: EventResourceSerializer},
    )
    def patch(self, request, site_pk, event_id, resource_id):
        _site, event = admin_event(request, site_pk, event_id)
        payload = EventResourceSerializer(data=request.data, partial=True)
        payload.is_valid(raise_exception=True)
        try:
            row = update_resource(event, resource_id, payload.validated_data, actor=request.user)
        except Exception as error:
            _domain_error(error)
        response = Response(serialize_resource(row, public=False))
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(
        operation_id="v1_sites_events_resources_destroy",
        tags=["Event Resources"],
        description="Remove the Event association only. Canonical Document/File is retained.",
    )
    def delete(self, request, site_pk, event_id, resource_id):
        _site, event = admin_event(request, site_pk, event_id)
        try:
            remove_resource(event, resource_id, actor=request.user)
        except Exception as error:
            _domain_error(error)
        return Response(status=204)


class SiteEventResourceVisibility(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="v1_sites_events_resources_visibility",
        tags=["Event Resources"],
        request=EventResourceVisibilitySerializer,
        responses={200: EventResourceSerializer},
        description="Publish/unpublish independently of the root Event and unrelated sessions.",
    )
    def post(self, request, site_pk, event_id, resource_id):
        _site, event = admin_event(request, site_pk, event_id)
        payload = EventResourceVisibilitySerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            row = set_resource_visibility(
                event, resource_id, visibility=payload.validated_data["visibility"], actor=request.user,
            )
        except Exception as error:
            _domain_error(error)
        response = Response(serialize_resource(row, public=False))
        response["Cache-Control"] = "private, no-store"
        return response


class SiteEventResourceFile(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ResourceFileThrottle]

    @extend_schema(
        operation_id="v1_sites_events_resources_file",
        tags=["Event Resources"],
        responses={200: {"description": "Authorized file stream"}},
    )
    def get(self, request, site_pk, event_id, resource_id):
        _site, event = admin_event(request, site_pk, event_id)
        parse_file_query(request)
        resource, asset, bucket, key = authorize_resource_file(
            event=event, resource_id=resource_id, request=request, management=True,
        )
        return resource_file_response(
            request=request, resource=resource, asset=asset, bucket=bucket, key=key,
        )


class PublicSiteEventResources(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "public, max-age=30"
        response["Vary"] = "Host, Origin"
        return response

    @extend_schema(
        operation_id="v1_site_context_events_resources_list",
        tags=["Public Events"],
        responses={200: PublicResourceSerializer(many=True)},
    )
    def get(self, request, slug):
        event = public_event(request, slug)
        return Response(list_public_resources(event))


class PublicSiteEventResourceEntitlement(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ResourceFileThrottle]

    @extend_schema(
        operation_id="v1_site_context_events_resources_entitlement",
        tags=["Public Events"],
        request=ResourceEntitlementInput,
        responses={200: ResourceGrantSerializer},
        description=(
            "Exchange a registration email + management token for a short-lived download grant "
            f"(default 300 seconds). Grants are revalidated at access time and stop working after unpublish."
        ),
    )
    def post(self, request, slug, resource_id):
        event = public_event(request, slug)
        payload = ResourceEntitlementInput(data=request.data)
        payload.is_valid(raise_exception=True)
        resource, _asset, _bucket, _key = authorize_resource_file(
            event=event,
            resource_id=resource_id,
            request=request,
            email=payload.validated_data["email"],
            token=payload.validated_data["token"],
        )
        verify_registration_entitlement(
            event=event,
            email=payload.validated_data["email"],
            token=payload.validated_data["token"],
        )
        grant = issue_download_grant(resource=resource)
        response = Response(grant)
        response["Cache-Control"] = "private, no-store"
        return response


class PublicSiteEventResourceFile(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ResourceFileThrottle]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store, max-age=0"
        response["Vary"] = "Host, Origin"
        return response

    @extend_schema(
        operation_id="v1_site_context_events_resources_file",
        tags=["Public Events"],
        parameters=[
            OpenApiParameter("inline", str, description="Set to 1 for PDF inline preview"),
            OpenApiParameter("grant", str, description="Short-lived registered-only grant"),
            OpenApiParameter("email", str),
            OpenApiParameter("token", str),
        ],
        responses={200: {"description": "Authorized file stream"}},
        description=(
            "Stream-after-auth download proxy. Public resources need no grant. "
            "Registered-only resources require a live entitlement or unexpired grant. "
            "Authorization is revalidated on every request; unpublished/draft/quarantined files return 404. "
            "No durable object-storage URLs are issued."
        ),
    )
    def get(self, request, slug, resource_id):
        event = public_event(request, slug)
        query = parse_file_query(request)
        resource, asset, bucket, key = authorize_resource_file(
            event=event,
            resource_id=resource_id,
            request=request,
            grant=query["grant"],
            email=query["email"],
            token=query["token"],
        )
        return resource_file_response(
            request=request, resource=resource, asset=asset, bucket=bucket, key=key,
        )
