"""Restricted administration API; scoped production writes await IAM/RBAC."""
import hashlib
import json
from contextlib import contextmanager

from django.conf import settings
from django.core.exceptions import ValidationError as DomainValidationError
from django.db import DatabaseError
from drf_spectacular.utils import OpenApiExample, OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException
from rest_framework.permissions import BasePermission, IsAuthenticated, SAFE_METHODS
from rest_framework.parsers import JSONParser
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.accounts.permissions import HasRealmRole

from ..hierarchy_lock import hierarchy_write
from ..models import OrganizationUnit
from ..selectors.api_hierarchy import HierarchyTooLarge, MAX_HIERARCHY_NODES, get_hierarchy_nodes
from ..selectors.discovery import discover_organizations
from .serializers import LifecycleRequestSerializer, OrganizationHierarchySerializer, OrganizationSerializer, OrganizationUpdateSerializer
from .discovery import DISCOVERY_PARAMETERS, OrganizationDiscoverySerializer


class Conflict(APIException):
    status_code = 409
    default_detail = "The organization conflicts with the current resource state."


class PreconditionRequired(APIException):
    status_code = 428
    default_detail = "Supply the current detail response ETag in If-Match."


class PreconditionFailed(APIException):
    status_code = 412
    default_detail = "The organization changed. Retrieve it and reconcile your changes."


class DevelopmentWritesOnly(BasePermission):
    message = "Organization writes require development mode and explicit opt-in; production writes await scoped IAM/RBAC."

    def has_permission(self, request, view):
        return request.method in SAFE_METHODS or (
            settings.DEBUG and settings.ORGANIZATIONS_DEV_WRITES_ENABLED
        )


@contextmanager
def translate_domain_errors():
    try:
        yield
    except DomainValidationError as exc:
        # Model validation includes field failures and state-dependent domain rules.
        errors = getattr(exc, "message_dict", {"non_field_errors": exc.messages})
        if "code" in errors and any("already exists" in str(message) for message in errors["code"]):
            raise Conflict({"code": ["An organization with this code already exists."]}) from exc
        raise serializers.ValidationError(errors) from exc
    except DatabaseError as exc:
        state = getattr(exc.__cause__, "sqlstate", None)
        if state in {"23505", "23503", "23514", "40001", "40P01"}:
            raise Conflict() from exc
        raise


IF_MATCH = OpenApiParameter(
    "If-Match", str, OpenApiParameter.HEADER, required=True,
    description="Exact strong ETag from GET detail. Missing: 428; stale/weak/wildcard: 412. Retrieve and reconcile before retrying.",
)
LIFECYCLE_BODY = {"application/json": {"type": "object", "additionalProperties": False, "maxProperties": 0}}


@extend_schema_view(
    list=extend_schema(parameters=DISCOVERY_PARAMETERS, description="Platform-admin only. Database-backed discovery with combined AND filters; search matches name OR code. All lifecycle states unless filtered. Page-number pagination (20), deterministic ordering. Unknown, repeated or invalid query parameters return 400."),
    retrieve=extend_schema(description="Platform-admin only. Returns a strong ETag for conditional mutations."),
    create=extend_schema(
        description="Development opt-in and platform-admin required. Creates ACTIVE units. Production writes are disabled. Codes normalize to uppercase and are immutable; duplicate codes return 409. No Idempotency-Key replay is supported.",
        examples=[OpenApiExample("College", value={"code": "INFORMATICS", "name": "College of Informatics", "organization_type": "COLLEGE", "parent": 1, "metadata": {}}, request_only=True)],
    ),
    partial_update=extend_schema(parameters=[IF_MATCH], description="Development admin only. Conditional partial update; code/status/IDs/timestamps cannot be supplied. Parent moves use serialized cycle validation."),
)
@extend_schema(tags=["Organizations"])
class OrganizationViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = OrganizationSerializer
    queryset = OrganizationUnit.objects.select_related("organization_type").order_by("code")
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated, HasRealmRole, DevelopmentWritesOnly]
    required_roles = {"platform-admin"}
    http_method_names = ["get", "post", "patch", "head", "options"]
    parser_classes = [JSONParser]
    renderer_classes = [JSONRenderer]

    def get_serializer_class(self):
        return OrganizationUpdateSerializer if self.action == "partial_update" else OrganizationSerializer

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        return response

    def _representation(self, unit):
        data = OrganizationSerializer(unit).data
        digest = hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return data, f'"{digest}"'

    def _response(self, unit, status=200):
        data, etag = self._representation(unit)
        response = Response(data, status=status, headers={"ETag": etag, "Cache-Control": "private, no-store"})
        if status == 201:
            from django.urls import reverse
            response["Location"] = reverse("organizations:organization-detail", args=[unit.pk])
        return response

    def retrieve(self, request, *args, **kwargs):
        return self._response(self.get_object())

    def list(self, request, *args, **kwargs):
        parameters = OrganizationDiscoverySerializer(data=request.query_params)
        parameters.is_valid(raise_exception=True)
        queryset = discover_organizations(self.filter_queryset(self.get_queryset()), parameters.validated_data)
        page = self.paginate_queryset(queryset)
        if page is not None:
            return self.get_paginated_response(self.get_serializer(page, many=True).data)
        return Response(self.get_serializer(queryset, many=True).data)

    def create(self, request, *args, **kwargs):
        if request.headers.get("Idempotency-Key") is not None:
            raise serializers.ValidationError({"Idempotency-Key": ["Replay is not supported. Resolve uncertain creates using the unique organization code."]})
        with translate_domain_errors(), hierarchy_write():
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            if OrganizationUnit.objects.filter(code=serializer.validated_data["code"]).exists():
                raise Conflict({"code": ["An organization with this code already exists."]})
            unit = serializer.save()
            return self._response(unit, status=201)

    def _locked_unit(self, request):
        unit = self.get_object()
        current = self._representation(unit)[1]
        if not request.headers.get("If-Match"):
            raise PreconditionRequired()
        # Require one exact strong ETag, deliberately excluding '*' blind writes.
        if request.headers["If-Match"] != current:
            raise PreconditionFailed()
        return unit

    def partial_update(self, request, *args, **kwargs):
        with translate_domain_errors(), hierarchy_write():
            unit = self._locked_unit(request)
            serializer = self.get_serializer(unit, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            return self._response(serializer.save())

    def _hierarchy(self, relation, unit_id=None):
        try:
            nodes = get_hierarchy_nodes(self.get_queryset(), relation, unit_id=unit_id)
        except HierarchyTooLarge as exc:
            raise Conflict({
                "detail": "Hierarchy response exceeds the node limit. Navigate direct children or use the paginated organization list.",
                "max_nodes": MAX_HIERARCHY_NODES,
            }) from exc
        return Response({"count": len(nodes), "results": OrganizationSerializer(nodes, many=True).data})

    @extend_schema(responses=OrganizationHierarchySerializer, filters=False, description="Platform-admin only. Full flat tree, including all lifecycle states. Breadth-first, code order within each depth. Parent IDs link nodes. Maximum 1000 nodes; overflow returns 409 without partial data. No pagination or depth truncation.")
    @action(detail=False, methods=["get"], pagination_class=None)
    def tree(self, request):
        return self._hierarchy("tree")

    @extend_schema(responses=OrganizationHierarchySerializer, filters=False, description="Platform-admin only. Direct children, code ordered, all lifecycle states; excludes the selected unit. Maximum 1000 nodes; overflow returns 409. No pagination.")
    @action(detail=True, methods=["get"], pagination_class=None)
    def children(self, request, pk=None):
        return self._hierarchy("children", self.get_object().pk)

    @extend_schema(responses=OrganizationHierarchySerializer, filters=False, description="Platform-admin only. Ancestors root-first; excludes the selected unit. Includes all lifecycle states. Maximum 1000 nodes; overflow returns 409. No pagination.")
    @action(detail=True, methods=["get"], pagination_class=None)
    def ancestors(self, request, pk=None):
        return self._hierarchy("ancestors", self.get_object().pk)

    @extend_schema(responses=OrganizationHierarchySerializer, filters=False, description="Platform-admin only. Descendants excluding self, breadth-first then code; all lifecycle states. Maximum 1000 nodes; overflow returns 409. No pagination.")
    @action(detail=True, methods=["get"], pagination_class=None)
    def descendants(self, request, pk=None):
        return self._hierarchy("descendants", self.get_object().pk)

    @extend_schema(responses=OrganizationHierarchySerializer, filters=False, description="Platform-admin only. Subtree including self, breadth-first then code; all lifecycle states. Maximum 1000 nodes; overflow returns 409. No pagination.")
    @action(detail=True, methods=["get"], pagination_class=None)
    def subtree(self, request, pk=None):
        return self._hierarchy("subtree", self.get_object().pk)

    def _transition(self, request, target):
        with translate_domain_errors(), hierarchy_write():
            unit = self._locked_unit(request)
            payload = LifecycleRequestSerializer(data=request.data)
            payload.is_valid(raise_exception=True)
            unit.status = target
            unit.save(update_fields=["status"])
            return self._response(unit)

    @extend_schema(parameters=[IF_MATCH], request=LIFECYCLE_BODY, responses=OrganizationSerializer, description="Development admin only. ACTIVE → INACTIVE; blocked by active descendants/Sites and root rules. Send {}.")
    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        return self._transition(request, OrganizationUnit.Status.INACTIVE)

    @extend_schema(parameters=[IF_MATCH], request=LIFECYCLE_BODY, responses=OrganizationSerializer, description="Development admin only. INACTIVE → ARCHIVED; historical references remain. Root and active descendant/Site rules apply. Send {}.")
    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        return self._transition(request, OrganizationUnit.Status.ARCHIVED)
