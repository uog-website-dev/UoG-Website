"""Site-scoped Post, Category and Tag administration API.

Every route is mounted under ``/api/v1/sites/{site_pk}/`` and follows the CMS
conventions shipped with the Pages API: Keycloak authentication, a database
CMS role on the owning Site (or platform administrator), the POSTS module gate,
page-number pagination, optimistic concurrency through ``If-Match``, and the
shared validation envelope for domain errors.
"""
from django.core.exceptions import ValidationError as DomainValidationError
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError, Q
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_date, parse_datetime
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, serializers, viewsets
from rest_framework.exceptions import APIException
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.cms.authorization import require_cms_grant
from apps.authorization.services import record_decision
from apps.cms.models import ContentRole, ContentStatus
from apps.sites.models import Site

from .models import Category, Post, Tag
from .serializers import CategorySerializer, PostSerializer, TagSerializer
from .services import require_posts_module


SITE_PARAMETER = OpenApiParameter(
    "site_pk", int, OpenApiParameter.PATH, description="Owning Site id.",
)
CONTENT_ID_PARAMETER = OpenApiParameter(
    "id", str, OpenApiParameter.PATH, description="Content UUID.",
)
IF_MATCH = OpenApiParameter(
    "If-Match", str, OpenApiParameter.HEADER, required=True,
    description="The current strong ETag returned by the detail response.",
)
PAGE_PARAMETER = OpenApiParameter("page", int)
PAGE_SIZE_PARAMETER = OpenApiParameter(
    "page_size", int, description="Default 20, maximum 100.",
)

UUID_PATTERN = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"


class ContentPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class ContentEditConflict(APIException):
    status_code = 409
    default_detail = "Content changed. Retrieve the current record and retry."


class ContentInUse(APIException):
    status_code = 409


class ModuleDisabled(APIException):
    status_code = 400
    default_detail = "The POSTS module is not enabled for this Site."


def _ordering(value, allowed, default):
    """Parse a comma-separated ordering list against an allowlist."""
    if value is None:
        return list(default)
    fields = [item.strip() for item in value.split(",") if item.strip()]
    names = [item.removeprefix("-") for item in fields]
    if (
        not fields
        or len(fields) > len(allowed)
        or any(name not in allowed for name in names)
        or len(set(names)) != len(names)
    ):
        raise serializers.ValidationError({
            "ordering": "Use distinct " + ", ".join(sorted(allowed))
                         + " fields; prefix '-' for descending.",
        })
    return fields


def _iso(value, field):
    parsed = parse_datetime(value) or parse_date(value)
    if parsed is None:
        raise serializers.ValidationError({
            field: "Use an ISO 8601 date or date-time.",
        })
    return parsed


def _strict_query(data, allowed):
    """Reject unknown and repeated query parameters with field-level errors."""
    errors = {key: ["Unknown query parameter."] for key in set(data) - set(allowed)}
    if hasattr(data, "getlist"):
        errors.update({
            key: ["Supply this query parameter only once."]
            for key in data if len(data.getlist(key)) != 1
        })
    if errors:
        raise serializers.ValidationError(errors)


def _domain_detail(error):
    return (
        error.message_dict if hasattr(error, "message_dict")
        else {"non_field_errors": error.messages}
    )


class SiteContentAdminViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Shared Site scoping, role checks, module gate and ETag handling."""

    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    queryset = Post.objects.none()
    pagination_class = ContentPagination
    lookup_value_regex = UUID_PATTERN
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    # Overridden per viewset.
    query_fields: tuple[str, ...] = ()
    ordering_fields: tuple[str, ...] = ()
    default_ordering: tuple[str, ...] = ()
    audit_action = ""
    permission_code = ""

    def get_queryset(self):
        return self.queryset.filter(site_id=self.kwargs["site_pk"]).select_related("site")

    def _site(self):
        return get_object_or_404(Site, pk=self.kwargs["site_pk"])

    def _authorize(self, site, required_roles):
        require_cms_grant(
            self.request.user, site.pk, required_roles, request=self.request,
        )

    def _module(self, site):
        """Block administration whenever the POSTS module is off."""
        try:
            require_posts_module(site.pk)
        except DomainValidationError as error:
            raise ModuleDisabled(_domain_detail(error)) from error

    def _record(self, action, instance, site_id, *, code):
        record_decision(
            user=self.request.user, action=action, outcome="CHANGE",
            permission_code=code, resource_type=self._type(),
            resource_id=instance.pk, site_id=site_id, request=self.request,
        )

    def _type(self):
        return self.queryset.model._meta.model_name

    def _response(self, instance, *, status_code=200):
        return Response(
            self.get_serializer(instance).data,
            status=status_code,
            headers={
                "ETag": content_etag(instance),
                "Cache-Control": "private, no-store",
            },
        )

    def list(self, request, *args, **kwargs):
        site = self._site()
        self._authorize(site, ContentRole.values)
        self._module(site)
        _strict_query(request.query_params, (*self.query_fields, "page", "page_size", "ordering"))
        queryset = self._filtered(self.get_queryset(), request.query_params)
        ordering = _ordering(
            request.query_params.get("ordering"), set(self.ordering_fields),
            self.default_ordering or ("id",),
        )
        if "id" not in [item.removeprefix("-") for item in ordering]:
            ordering = [*ordering, "id"]
        queryset = queryset.order_by(*ordering).distinct()
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        return paginator.get_paginated_response(
            self.get_serializer(page, many=True).data,
        )

    def _filtered(self, queryset, params):
        term = (params.get("search") or "").strip()
        if term:
            queryset = queryset.filter(self.search_q(term))
        for name, lookup in self.filters().items():
            value = params.get(name)
            if value not in (None, ""):
                queryset = queryset.filter(**{lookup: self.coerce(name, value)})
        return queryset

    def search_q(self, term):
        return Q(name__icontains=term) | Q(slug__icontains=term)

    def filters(self):
        return {}

    def coerce(self, name, value):
        return value

    def retrieve(self, request, *args, **kwargs):
        site = self._site()
        self._authorize(site, ContentRole.values)
        self._module(site)
        instance = get_object_or_404(self.get_queryset(), pk=self.kwargs["pk"])
        return self._response(instance)

    def create(self, request, *args, **kwargs):
        site = self._site()
        self._authorize(site, (ContentRole.AUTHOR,))
        self._module(site)
        serializer = self.get_serializer(
            data=request.data,
            context={**self.get_serializer_context(), "site": site},
        )
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                instance = serializer.save(
                    site=site,
                    created_by=request.user,
                    updated_by=request.user,
                    **self.create_defaults(),
                )
        except DomainValidationError as error:
            raise serializers.ValidationError(_domain_detail(error)) from error
        except IntegrityError as error:
            raise serializers.ValidationError({
                "slug": ["This slug is already used in this Site and language."],
            }) from error
        self._record(
            f"{self.audit_action}_CREATED", instance, site.pk,
            code=f"{self.permission_code}.create",
        )
        response = self._response(instance, status_code=201)
        response["Location"] = self._location(site, instance)
        return response

    def create_defaults(self):
        return {}

    def _location(self, site, instance):
        return f"/api/v1/sites/{site.pk}/{self.route}/{instance.pk}/"

    def partial_update(self, request, *args, **kwargs):
        site = self._site()
        self._authorize(site, (ContentRole.AUTHOR,))
        supplied = request.headers.get("If-Match")
        if not supplied:
            from apps.sites.api.access import PreconditionRequired
            raise PreconditionRequired()
        self._module(site)
        try:
            with transaction.atomic():
                instance = get_object_or_404(
                    self.get_queryset().select_for_update(of=("self",)),
                    pk=self.kwargs["pk"],
                )
                if supplied != content_etag(instance):
                    raise ContentEditConflict()
                serializer = self.get_serializer(
                    instance, data=request.data, partial=True,
                )
                serializer.is_valid(raise_exception=True)
                instance = serializer.save(updated_by=request.user)
        except DomainValidationError as error:
            raise serializers.ValidationError(_domain_detail(error)) from error
        except IntegrityError as error:
            raise ContentEditConflict(
                "This change conflicts with the current content (possibly a "
                "duplicate slug in this Site and language)."
            ) from error
        self._record(
            f"{self.audit_action}_UPDATED", instance, site.pk,
            code=f"{self.permission_code}.update",
        )
        return self._response(instance)

    def destroy(self, request, *args, **kwargs):
        site = self._site()
        self._authorize(site, (ContentRole.AUTHOR,))
        self._module(site)
        instance = get_object_or_404(self.get_queryset(), pk=self.kwargs["pk"])
        try:
            with transaction.atomic():
                instance.delete()
        except ProtectedError as error:
            raise ContentInUse(self.protected_detail) from error
        except IntegrityError as error:
            raise ContentInUse(
                "This record has immutable history or is referenced elsewhere "
                "and cannot be deleted."
            ) from error
        self._record(
            f"{self.audit_action}_DELETED", instance, site.pk,
            code=f"{self.permission_code}.delete",
        )
        return Response(status=204, headers={"Cache-Control": "private, no-store"})

    protected_detail = "This record is referenced elsewhere and cannot be deleted."


def content_etag(instance):
    return f'"cms-content-{instance.pk}-r{instance.revision_number}"'


@extend_schema(tags=["Posts"])
class PostViewSet(SiteContentAdminViewSet):
    """Author and administer Posts inside the Site named in the URL."""

    queryset = Post.objects.all()
    serializer_class = PostSerializer
    route = "posts"
    query_fields = (
        "search", "status", "locale", "category", "tag", "author",
        "created_after", "created_before", "published_after", "published_before",
    )
    ordering_fields = (
        "title", "slug", "status", "created_at", "updated_at", "published_at",
    )
    default_ordering = ("-created_at",)
    audit_action = "POST"
    permission_code = "content.posts"
    protected_detail = (
        "This Post is referenced by a menu item. Remove or re-target the menu "
        "item before deleting the Post."
    )

    def create_defaults(self):
        return {"author": self.request.user}

    def search_q(self, term):
        return (
            Q(title__icontains=term)
            | Q(slug__icontains=term)
            | Q(excerpt__icontains=term)
            | Q(content__icontains=term)
        )

    def filters(self):
        return {
            "status": "status",
            "locale": "locale",
            "category": "categories__pk",
            "tag": "tags__pk",
            "author": "author_id",
            "created_after": "created_at__gte",
            "created_before": "created_at__lte",
            "published_after": "published_at__gte",
            "published_before": "published_at__lte",
        }

    def coerce(self, name, value):
        if name in {"category", "tag"}:
            try:
                from uuid import UUID
                return UUID(str(value))
            except ValueError as error:
                raise serializers.ValidationError({
                    name: "Use the UUID of an existing taxonomy record.",
                }) from error
        if name == "author":
            try:
                return int(value)
            except (TypeError, ValueError) as error:
                raise serializers.ValidationError({
                    "author": "Use the numeric id of a platform user.",
                }) from error
        if name == "status":
            if value not in ContentStatus.values:
                raise serializers.ValidationError({
                    "status": "Use one of " + ", ".join(ContentStatus.values) + ".",
                })
            return value
        if name.startswith(("created_", "published_")):
            return _iso(value, name)
        return value

    @extend_schema(
        tags=["Posts"],
        parameters=[
            SITE_PARAMETER,
            OpenApiParameter("search", str, description="Case-insensitive title, slug, excerpt or body substring."),
            OpenApiParameter("status", str, enum=ContentStatus.values),
            OpenApiParameter("locale", str),
            OpenApiParameter("category", str, description="Category UUID."),
            OpenApiParameter("tag", str, description="Tag UUID."),
            OpenApiParameter("author", int, description="Author user id."),
            OpenApiParameter("created_after", str, description="ISO 8601 date or date-time."),
            OpenApiParameter("created_before", str, description="ISO 8601 date or date-time."),
            OpenApiParameter("published_after", str, description="ISO 8601 date or date-time."),
            OpenApiParameter("published_before", str, description="ISO 8601 date or date-time."),
            OpenApiParameter("ordering", str, description="Comma-separated title, slug, status, created_at, updated_at or published_at; prefix '-' for descending."),
            PAGE_PARAMETER, PAGE_SIZE_PARAMETER,
        ],
        responses=PostSerializer(many=True),
        description=(
            "List only Posts belonging to this Site. Requires an active Site "
            "AUTHOR, REVIEWER or PUBLISHER assignment, or an active database "
            "platform-administrator assignment. Keycloak realm roles do not "
            "grant access. Also requires an "
            "enabled POSTS module. Unknown or repeated query parameters return "
            "field-level 400 errors."
        ),
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @extend_schema(tags=["Posts"], parameters=[SITE_PARAMETER, CONTENT_ID_PARAMETER], responses=PostSerializer)
    def retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    @extend_schema(
        tags=["Posts"], parameters=[SITE_PARAMETER], request=PostSerializer,
        responses={201: PostSerializer},
        description=(
            "Create a draft Post in this Site. Requires an active Site AUTHOR "
            "assignment or an active database platform-administrator "
            "assignment. Keycloak realm roles do not grant access. Requires an enabled POSTS module. Site, status, "
            "publication timestamp and revision are server-controlled."
        ),
    )
    def create(self, request, *args, **kwargs):
        return super().create(request, *args, **kwargs)

    @extend_schema(
        tags=["Posts"], parameters=[SITE_PARAMETER, CONTENT_ID_PARAMETER, IF_MATCH],
        request=PostSerializer, responses=PostSerializer,
        description=(
            "Partially update a Post. Requires an active Site AUTHOR assignment "
            "or an active database platform-administrator assignment. "
            "Keycloak realm roles do not grant access. Also requires "
            "an enabled POSTS module and the current If-Match ETag. Missing "
            "preconditions return 428; stale edits and duplicate slugs return 409."
        ),
    )
    def partial_update(self, request, *args, **kwargs):
        return super().partial_update(request, *args, **kwargs)

    @extend_schema(tags=["Posts"], parameters=[SITE_PARAMETER, CONTENT_ID_PARAMETER], responses={204: None})
    def destroy(self, request, *args, **kwargs):
        return super().destroy(request, *args, **kwargs)


@extend_schema(tags=["Posts"])
class TaxonomyViewSet(SiteContentAdminViewSet):
    """Shared list/create/update/delete behaviour for Category and Tag."""

    query_fields = ("search", "is_active", "locale")
    ordering_fields = ("name", "slug", "code", "created_at", "updated_at")
    default_ordering = ("name",)
    audit_action = "TAXONOMY"
    permission_code = "content.posts.taxonomy"
    protected_detail = "This taxonomy record is still referenced and cannot be deleted."

    def search_q(self, term):
        return (
            Q(name__icontains=term)
            | Q(slug__icontains=term)
            | Q(code__icontains=term)
        )

    def filters(self):
        return {"is_active": "is_active", "locale": "locale"}

    def coerce(self, name, value):
        if name == "is_active":
            lowered = str(value).lower()
            if lowered in {"true", "1"}:
                return True
            if lowered in {"false", "0"}:
                return False
            raise serializers.ValidationError({
                "is_active": "Use true or false.",
            })
        return value

    def create_defaults(self):
        return {}

    @extend_schema(
        tags=["Posts"],
        parameters=[
            SITE_PARAMETER,
            OpenApiParameter("search", str, description="Case-insensitive name, slug or code substring."),
            OpenApiParameter("is_active", bool, description="Only active or only inactive terms."),
            OpenApiParameter("locale", str),
            OpenApiParameter("ordering", str, description="Comma-separated name, slug, code, created_at or updated_at; prefix '-' for descending."),
            PAGE_PARAMETER, PAGE_SIZE_PARAMETER,
        ],
        responses=CategorySerializer(many=True),
        description=(
            "List only taxonomy terms belonging to this Site. Requires an "
            "active Site CMS role or an active database platform-administrator "
            "assignment, and an enabled POSTS module. Keycloak realm roles "
            "do not grant access."
        ),
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @extend_schema(tags=["Posts"], parameters=[SITE_PARAMETER, CONTENT_ID_PARAMETER], responses=CategorySerializer)
    def retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    @extend_schema(
        tags=["Posts"], parameters=[SITE_PARAMETER], request=CategorySerializer,
        responses={201: CategorySerializer},
        description=(
            "Create a taxonomy term in this Site. The slug is derived from the "
            "name when omitted and must stay unique per (Site, language)."
        ),
    )
    def create(self, request, *args, **kwargs):
        return super().create(request, *args, **kwargs)

    @extend_schema(tags=["Posts"], parameters=[SITE_PARAMETER, CONTENT_ID_PARAMETER, IF_MATCH], request=CategorySerializer, responses=CategorySerializer)
    def partial_update(self, request, *args, **kwargs):
        return super().partial_update(request, *args, **kwargs)

    @extend_schema(tags=["Posts"], parameters=[SITE_PARAMETER, CONTENT_ID_PARAMETER], responses={204: None})
    def destroy(self, request, *args, **kwargs):
        return super().destroy(request, *args, **kwargs)


class CategoryViewSet(TaxonomyViewSet):
    """Site-scoped Category administration."""

    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    route = "categories"

    @extend_schema(
        tags=["Posts"],
        parameters=[
            SITE_PARAMETER,
            OpenApiParameter("search", str, description="Case-insensitive name, slug or code substring."),
            OpenApiParameter("is_active", bool, description="Only active or only inactive terms."),
            OpenApiParameter("locale", str),
            OpenApiParameter("ordering", str, description="Comma-separated name, slug, code, created_at or updated_at; prefix '-' for descending."),
            PAGE_PARAMETER, PAGE_SIZE_PARAMETER,
        ],
        responses=CategorySerializer(many=True),
        description=(
            "List only taxonomy terms belonging to this Site. Requires an "
            "active Site CMS role or an active database platform-administrator "
            "assignment, and an enabled POSTS module. Keycloak realm roles "
            "do not grant access."
        ),
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @extend_schema(tags=["Posts"], parameters=[SITE_PARAMETER, CONTENT_ID_PARAMETER], responses=CategorySerializer)
    def retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    @extend_schema(
        tags=["Posts"], parameters=[SITE_PARAMETER], request=CategorySerializer,
        responses={201: CategorySerializer},
        description=(
            "Create a taxonomy term in this Site. The slug is derived from the "
            "name when omitted and must stay unique per (Site, language)."
        ),
    )
    def create(self, request, *args, **kwargs):
        return super().create(request, *args, **kwargs)

    @extend_schema(tags=["Posts"], parameters=[SITE_PARAMETER, CONTENT_ID_PARAMETER, IF_MATCH], request=CategorySerializer, responses=CategorySerializer)
    def partial_update(self, request, *args, **kwargs):
        return super().partial_update(request, *args, **kwargs)

    @extend_schema(tags=["Posts"], parameters=[SITE_PARAMETER, CONTENT_ID_PARAMETER], responses={204: None})
    def destroy(self, request, *args, **kwargs):
        return super().destroy(request, *args, **kwargs)


class TagViewSet(CategoryViewSet):
    """Site-scoped Tag administration."""

    queryset = Tag.objects.all()
    serializer_class = TagSerializer
    route = "tags"

    @extend_schema(
        tags=["Posts"],
        parameters=[
            SITE_PARAMETER,
            OpenApiParameter("search", str, description="Case-insensitive name, slug or code substring."),
            OpenApiParameter("is_active", bool, description="Only active or only inactive terms."),
            OpenApiParameter("locale", str),
            OpenApiParameter("ordering", str, description="Comma-separated name, slug, code, created_at or updated_at; prefix '-' for descending."),
            PAGE_PARAMETER, PAGE_SIZE_PARAMETER,
        ],
        responses=TagSerializer(many=True),
        description=(
            "List only tags belonging to this Site. Requires an active Site CMS "
            "role or an active database platform-administrator assignment, "
            "and an enabled POSTS module. Keycloak realm roles do not grant "
            "access."
        ),
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @extend_schema(tags=["Posts"], parameters=[SITE_PARAMETER, CONTENT_ID_PARAMETER], responses=TagSerializer)
    def retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    @extend_schema(tags=["Posts"], parameters=[SITE_PARAMETER], request=TagSerializer, responses={201: TagSerializer})
    def create(self, request, *args, **kwargs):
        return super().create(request, *args, **kwargs)

    @extend_schema(tags=["Posts"], parameters=[SITE_PARAMETER, CONTENT_ID_PARAMETER, IF_MATCH], request=TagSerializer, responses=TagSerializer)
    def partial_update(self, request, *args, **kwargs):
        return super().partial_update(request, *args, **kwargs)

    @extend_schema(tags=["Posts"], parameters=[SITE_PARAMETER, CONTENT_ID_PARAMETER], responses={204: None})
    def destroy(self, request, *args, **kwargs):
        return super().destroy(request, *args, **kwargs)
