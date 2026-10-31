"""Site-scoped Page authoring and workflow API."""
from django.core.exceptions import PermissionDenied, ValidationError as DomainValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, serializers
from rest_framework.decorators import action
from rest_framework.exceptions import APIException
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet
from uuid import UUID

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.authorization.access import is_platform_administrator
from apps.sites.api.access import Conflict, PreconditionRequired
from apps.sites.api.serializers import StrictFields
from apps.sites.models import Site

from ..models import (
    ContentEditConflict,
    ContentRole,
    ContentWorkflowTransition,
    Page,
    SiteContentRoleAssignment,
)
from ..services.pages import change_route, require_pages_module, set_as_homepage
from ..services.workflow import transition_content
from .serializers import PageSerializer
from .workflow import WorkflowActionInput, WorkflowStateConflict


SITE_PARAMETER = OpenApiParameter(
    "site_pk", int, OpenApiParameter.PATH, description="Owning Site id.",
)
PAGE_PARAMETER = OpenApiParameter(
    "id", UUID, OpenApiParameter.PATH, description="Page UUID.",
)
IF_MATCH = OpenApiParameter(
    "If-Match", str, OpenApiParameter.HEADER, required=True,
    description="The current strong ETag returned by Page detail.",
)


class PageListQuery(StrictFields, serializers.Serializer):
    search = serializers.CharField(required=False, allow_blank=True, max_length=255)
    status = serializers.ChoiceField(
        choices=("DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"),
        required=False,
    )
    visibility = serializers.ChoiceField(
        choices=("PUBLIC", "UNLISTED", "HIDDEN"), required=False,
    )
    locale = serializers.CharField(required=False, max_length=35)
    parent = serializers.UUIDField(required=False)
    ordering = serializers.CharField(required=False, max_length=80)

    def to_internal_value(self, data):
        allowed = set(self.fields) | {"page", "page_size"}
        errors = {
            key: ["Unknown query parameter."]
            for key in set(data) - allowed
        }
        if hasattr(data, "getlist"):
            errors.update({
                key: ["Supply this query parameter only once."]
                for key in data if len(data.getlist(key)) != 1
            })
        if errors:
            raise serializers.ValidationError(errors)
        return super().to_internal_value({
            key: value for key, value in data.items() if key in self.fields
        })

    def validate_ordering(self, value):
        allowed = {"title", "slug", "position", "updated_at"}
        fields = [item.strip() for item in value.split(",")]
        names = [item.removeprefix("-") for item in fields]
        if (
            not fields or len(fields) > len(allowed)
            or any(name not in allowed for name in names)
            or len(set(names)) != len(names)
        ):
            raise serializers.ValidationError(
                "Use distinct title, slug, position or updated_at fields; "
                "prefix '-' for descending."
            )
        if "position" not in names:
            fields.append("position")
        return fields


class SitePagePagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class PageEditConflict(APIException):
    status_code = 409
    default_detail = "Content changed. Retrieve the current Page and retry."


class PageWorkflowHistorySerializer(serializers.ModelSerializer):
    actor = serializers.IntegerField(source="actor_id", allow_null=True, read_only=True)

    class Meta:
        model = ContentWorkflowTransition
        fields = ("id", "from_status", "to_status", "actor", "comment", "created_at")
        read_only_fields = fields


class SitePageViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    GenericViewSet,
):
    """Author and inspect Pages within the Site named in the URL."""

    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    serializer_class = PageSerializer
    queryset = Page.objects.none()
    lookup_value_regex = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    pagination_class = SitePagePagination
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        return Page.objects.filter(site_id=self.kwargs["site_pk"]).select_related(
            "site", "parent",
        )

    def _site(self):
        return get_object_or_404(Site, pk=self.kwargs["site_pk"])

    def _roles(self):
        claims = self.request.auth
        roles = getattr(claims, "roles", ())
        roles = set(roles) if isinstance(roles, (tuple, list, set, frozenset)) else set()
        # Database assignments are the platform's authorization source. A
        # platform administrator must not need a duplicate Keycloak role.
        if is_platform_administrator(self.request.user):
            roles.add("platform-admin")
        return roles

    def _authorize(self, site, required_roles):
        if is_platform_administrator(self.request.user) or "platform-admin" in set(self._roles()):
            return
        if SiteContentRoleAssignment.objects.filter(
            site_id=site.pk,
            user_id=self.request.user.pk,
            role__in=required_roles,
            user__is_active=True,
        ).exists():
            return
        raise PermissionDenied("A CMS role assigned to this Site is required.")

    def _page(self):
        site = self._site()
        self._authorize(site, ContentRole.values)
        page = get_object_or_404(self.get_queryset(), pk=self.kwargs["pk"])
        return site, page

    @extend_schema(
        tags=["CMS pages"],
        parameters=[
            SITE_PARAMETER,
            OpenApiParameter("search", str, description="Case-insensitive title or slug substring."),
            OpenApiParameter("status", str, enum=("DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED", "UNPUBLISHED", "ARCHIVED")),
            OpenApiParameter("visibility", str, enum=("PUBLIC", "UNLISTED", "HIDDEN")),
            OpenApiParameter("locale", str),
            OpenApiParameter("parent", str, description="Filter by parent Page UUID."),
            OpenApiParameter("ordering", str, description="Comma-separated title, slug, position or updated_at fields."),
            OpenApiParameter("page", int),
            OpenApiParameter("page_size", int, description="Default 20, maximum 100."),
        ],
        responses=PageSerializer(many=True),
        description=(
            "List only Pages belonging to this Site. Requires an active "
            "Site AUTHOR, REVIEWER or PUBLISHER assignment or platform-admin. "
            "Unknown or repeated query parameters return field-level 400 errors."
        ),
    )
    def list(self, request, *args, **kwargs):
        site = self._site()
        self._authorize(site, ContentRole.values)
        query = PageListQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        filters = query.validated_data
        queryset = self.get_queryset()
        if "search" in filters and filters["search"].strip():
            term = filters["search"].strip()
            queryset = queryset.filter(Q(title__icontains=term) | Q(slug__icontains=term))
        for field in ("status", "visibility", "locale", "parent"):
            if field in filters:
                queryset = queryset.filter(**{field: filters[field]})
        ordering = filters.get("ordering", ["position", "id"])
        if "id" not in [item.removeprefix("-") for item in ordering]:
            ordering = [*ordering, "id"]
        queryset = queryset.order_by(*ordering)
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        return paginator.get_paginated_response(
            self.get_serializer(page, many=True).data,
        )

    @extend_schema(
        tags=["CMS pages"],
        parameters=[SITE_PARAMETER, PAGE_PARAMETER],
        responses=PageSerializer,
        description="Read a Page belonging to this Site. Cross-Site identifiers return 404.",
    )
    def retrieve(self, request, *args, **kwargs):
        _site, page = self._page()
        return self._response(page)

    @extend_schema(
        tags=["CMS pages"],
        parameters=[SITE_PARAMETER],
        request=PageSerializer,
        responses={201: PageSerializer},
        description=(
            "Create a draft Page in this Site. Requires Site AUTHOR or "
            "platform-admin. The Site, status, route path and authorship are "
            "server-controlled."
        ),
    )
    def create(self, request, *args, **kwargs):
        site = self._site()
        self._authorize(site, (ContentRole.AUTHOR,))
        ensure_pages_module_enabled(site.pk)
        serializer = self.get_serializer(
            data=request.data,
            context={**self.get_serializer_context(), "site": site},
        )
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                page = serializer.save(
                    site=site,
                    created_by=request.user,
                    updated_by=request.user,
                )
        except IntegrityError as error:
            raise Conflict() from error
        response = self._response(page, status_code=201)
        response["Location"] = f"/api/v1/sites/{site.pk}/pages/{page.pk}/"
        return response

    @extend_schema(
        tags=["CMS pages"],
        parameters=[SITE_PARAMETER, PAGE_PARAMETER, IF_MATCH],
        request=PageSerializer,
        responses=PageSerializer,
        description=(
            "Partially update a draft or unpublished Page. Requires Site "
            "AUTHOR or platform-admin and the current If-Match ETag. Missing "
            "preconditions return 428; stale edits return 409. Parent changes "
            "must target this Site and preserve route history for descendants."
        ),
    )
    def partial_update(self, request, *args, **kwargs):
        site = self._site()
        self._authorize(site, (ContentRole.AUTHOR,))
        supplied = request.headers.get("If-Match")
        if not supplied:
            raise PreconditionRequired()
        ensure_pages_module_enabled(site.pk)
        try:
            with transaction.atomic():
                page = get_object_or_404(
                    self.get_queryset().select_for_update(of=("self",)),
                    pk=self.kwargs["pk"],
                )
                if supplied != page_etag(page):
                    raise PageEditConflict()
                serializer = self.get_serializer(
                    page, data=request.data, partial=True,
                )
                serializer.is_valid(raise_exception=True)
                values = dict(serializer.validated_data)
                requested_slug = values.pop("slug", page.slug)
                requested_parent = values.pop("parent", page.parent)
                for field, value in values.items():
                    setattr(page, field, value)
                page.updated_by = request.user
                route_changes = {}
                if requested_slug != page.slug:
                    route_changes["slug"] = requested_slug
                if requested_parent != page.parent:
                    route_changes["parent"] = requested_parent
                if route_changes:
                    page = change_route(
                        page, **route_changes, actor=request.user,
                    )
                else:
                    page.save()
        except ContentEditConflict as error:
            raise PageEditConflict() from error
        except IntegrityError as error:
            raise Conflict() from error
        except DomainValidationError as error:
            detail = (
                error.message_dict if hasattr(error, "message_dict")
                else {"non_field_errors": error.messages}
            )
            raise serializers.ValidationError(detail) from error
        return self._response(page)

    @extend_schema(
        tags=["CMS pages"],
        parameters=[SITE_PARAMETER, PAGE_PARAMETER],
        request=WorkflowActionInput,
        responses=PageSerializer,
        description=(
            "Submit, review, approve, reject, publish, unpublish, archive or "
            "restore this Site-owned Page using the shared CMS state machine. "
            "Role claims are read only from the validated bearer token."
        ),
    )
    @action(detail=True, methods=["post"], url_path="workflow")
    def workflow(self, request, *args, **kwargs):
        site, page = self._page()
        ensure_pages_module_enabled(site.pk)
        payload = WorkflowActionInput(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            transitioned = transition_content(
                page.pk,
                action=payload.validated_data["action"],
                actor=request.user,
                roles=self._roles(),
                comment=payload.validated_data.get("comment", ""),
            )
        except DomainValidationError as error:
            detail = (
                error.message_dict if hasattr(error, "message_dict")
                else {"non_field_errors": error.messages}
            )
            if "status" in detail:
                raise WorkflowStateConflict(detail) from error
            raise serializers.ValidationError(detail) from error
        page = get_object_or_404(
            Page.objects.filter(site_id=site.pk), pk=transitioned.pk,
        )
        return self._response(page)

    @extend_schema(
        tags=["CMS pages"],
        parameters=[SITE_PARAMETER, PAGE_PARAMETER],
        responses=PageWorkflowHistorySerializer(many=True),
        description=(
            "List append-only workflow transitions and reviewer comments for "
            "this Site-owned Page. Requires an active CMS role on this Site "
            "or platform-admin and an enabled PAGES module."
        ),
    )
    @action(
        detail=True, methods=["get"], url_path="workflow-history",
        pagination_class=None,
    )
    def workflow_history(self, request, *args, **kwargs):
        site, page = self._page()
        ensure_pages_module_enabled(site.pk)
        history = ContentWorkflowTransition.objects.filter(
            content_id=page.pk,
        ).select_related("actor")
        return Response(
            PageWorkflowHistorySerializer(history, many=True).data,
            headers={"Cache-Control": "private, no-store"},
        )

    @extend_schema(
        tags=["CMS pages"],
        parameters=[SITE_PARAMETER, PAGE_PARAMETER],
        request=None,
        responses=PageSerializer,
        description=(
            "Make this draft or unpublished Page the Site homepage. Any "
            "previous homepage on this Site is cleared in the same "
            "transaction. Requires Site AUTHOR or platform-admin and an "
            "enabled PAGES module. The row is not deleted when the module "
            "is off."
        ),
    )
    @action(detail=True, methods=["post"], url_path="homepage")
    def homepage(self, request, *args, **kwargs):
        site, page = self._page()
        self._authorize(site, (ContentRole.AUTHOR,))
        ensure_pages_module_enabled(site.pk)
        try:
            with transaction.atomic():
                page = set_as_homepage(page, actor=request.user)
        except DomainValidationError as error:
            detail = (
                error.message_dict if hasattr(error, "message_dict")
                else {"non_field_errors": error.messages}
            )
            raise serializers.ValidationError(detail) from error
        page = get_object_or_404(
            Page.objects.filter(site_id=site.pk), pk=page.pk,
        )
        return self._response(page)

    def _response(self, page, *, status_code=200):
        response = Response(
            self.get_serializer(page).data,
            status=status_code,
            headers={"ETag": page_etag(page), "Cache-Control": "private, no-store"},
        )
        return response


def page_etag(page):
    return f'"cms-content-{page.pk}-r{page.revision_number}"'


def ensure_pages_module_enabled(site_id):
    """Map a disabled PAGES module to the shared validation envelope."""
    try:
        require_pages_module(site_id)
    except DomainValidationError as error:
        fields = (
            error.message_dict if hasattr(error, "message_dict")
            else {"module": error.messages}
        )
        raise serializers.ValidationError({
            "reason": "module_disabled",
            "fields": fields,
        }) from error
