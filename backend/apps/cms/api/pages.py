"""Site-scoped Page authoring and workflow API."""
from apps.organizations.hierarchy_lock import hierarchy_write
from django.core.exceptions import ValidationError as DomainValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiExample, OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import mixins, serializers
from rest_framework.decorators import action
from rest_framework.exceptions import APIException
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet
from rest_framework.renderers import JSONRenderer
from django.utils.cache import patch_vary_headers
from apps.media.delivery import ImageDeliveryMixin, WebPImageRenderer
from uuid import UUID

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.sites.api.access import Conflict, PreconditionRequired
from apps.sites.api.serializers import StrictFields, EmptyObjectSerializer
from apps.sites.models import Site

from ..authorization import require_cms_grant
from ..models import (
    ContentEditConflict,
    ContentRole,
    ContentWorkflowTransition,
    Page,
)
from ..services.pages import change_route, require_pages_module, require_visual_builder_module
from ..services.homepage import assign_homepage
from ..services.workflow import transition_content
from ..services.working_drafts import content_etag, open_working_draft, save_visual_draft
from ..services import section_templates as section_template_domain
from .visual_drafts import VISUAL_DRAFT_REQUEST_SCHEMA, VisualDraftInput, VisualDraftErrorSerializer, VisualDraftValidationError
from .serializers import PageSerializer
from .preview import PagePreviewSerializer, preview_revision
from .widget_runtime import WidgetQuery, WidgetPayload, widget_data
from .workflow import WorkflowActionInput, WorkflowStateConflict, workflow_expected_revision, VISUAL_WORKFLOW_IF_MATCH


class InsertSectionTemplateInput(StrictFields, serializers.Serializer):
    template_id = serializers.UUIDField()


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
        fields = ("id", "from_status", "to_status", "actor", "comment", "created_at", "revision", "reviewed_revision")
        read_only_fields = fields


class SitePageViewSet(
    ImageDeliveryMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    GenericViewSet,
):
    """Author and inspect Pages within the Site named in the URL."""
    renderer_classes=[JSONRenderer]

    def finalize_response(self, request, response, *args, **kwargs):
        response=super().finalize_response(request,response,*args,**kwargs)
        if getattr(self,"action",None)=="preview":
            response["Cache-Control"]="private, no-store"
            response["Surrogate-Control"]="no-store"
            response["X-Robots-Tag"]="noindex, nofollow"
            patch_vary_headers(response,("Authorization","Cookie","Host"))
        return response

    @extend_schema(tags=["CMS pages"],parameters=[SITE_PARAMETER,PAGE_PARAMETER,
        OpenApiParameter("revision",int,description="Immutable revision number; defaults to current."),
        OpenApiParameter("asset_id",str,description="Optional referenced asset UUID for private image bytes."),
        OpenApiParameter("variant",str,enum=["thumbnail","display"])],
        responses={200:PagePreviewSerializer,(200,"image/webp"):{"type":"string","format":"binary"}},
        description="Private revision preview for this Site's CMS readers. Immutable revision IDs, content hash and approval provenance; no-store and Vary Authorization/Cookie/Host. Optional asset_id only serves an image referenced by this exact revision. Anonymous/foreign access fails; nothing enters public caches.")
    @action(detail=True,methods=["get"],url_path="preview",renderer_classes=[JSONRenderer,WebPImageRenderer])
    def preview(self,request,*args,**kwargs):
        site,page=self._page()
        ensure_pages_module_enabled(site.pk)
        return preview_revision(request,page)

    @extend_schema(tags=["CMS pages"], parameters=[SITE_PARAMETER, PAGE_PARAMETER, WidgetQuery], responses=WidgetPayload,
                   description="Private Site-scoped widget preview data from published content. Requires CMS read access and enabled PAGES and VISUAL_BUILDER. Responses are private/no-store.")
    @action(detail=True, methods=["get"], url_path="widget-data")
    def widget_data(self, request, *args, **kwargs):
        site, page = self._page()
        ensure_pages_module_enabled(site.pk)
        ensure_visual_builder_module_enabled(site.pk)
        query = WidgetQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        return Response(widget_data(site, query.validated_data), headers={"Cache-Control": "private, no-store", "Vary": "Authorization, Cookie, Host"})

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

    def _authorize(self, site, required_roles):
        require_cms_grant(
            self.request.user, site.pk, required_roles, request=self.request,
        )

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
            "Site AUTHOR, REVIEWER or PUBLISHER assignment, or an active "
            "database platform-administrator assignment. Keycloak realm roles "
            "do not grant access. Unknown or repeated query parameters return "
            "field-level 400 errors."
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
            "Create a draft Page in this Site. Requires an active Site AUTHOR "
            "assignment or an active database platform-administrator "
            "assignment. Keycloak realm roles do not grant access. The Site, "
            "status, route path and authorship are server-controlled."
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
            with hierarchy_write():
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
            "Partially update a draft or unpublished Page. Requires an active "
            "Site AUTHOR assignment or an active database "
            "platform-administrator assignment, and the current If-Match ETag. "
            "Keycloak realm roles do not grant access. Missing preconditions "
            "return 428; stale edits return 409. Parent changes must target "
            "this Site and preserve route history for descendants."
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
            with hierarchy_write():
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
        parameters=[SITE_PARAMETER, PAGE_PARAMETER, VISUAL_WORKFLOW_IF_MATCH],
        request=WorkflowActionInput,
        responses=PageSerializer,
        description=(
            "Submit, review, approve, reject, publish, unpublish, archive or "
            "restore this Site-owned Page using the shared CMS state machine. "
            "The action requires the matching Site CMS role, or an active "
            "database platform-administrator assignment. Keycloak realm roles "
            "and body-supplied roles do not grant access. An author cannot "
            "review their own content."
        ),
    )
    @action(detail=True, methods=["post"], url_path="workflow")
    def workflow(self, request, *args, **kwargs):
        site, page = self._page()
        ensure_pages_module_enabled(site.pk)
        payload = WorkflowActionInput(data=request.data)
        payload.is_valid(raise_exception=True)
        expected = workflow_expected_revision(request,page,payload.validated_data["action"])
        try:
            transitioned = transition_content(
                page.pk,
                action=payload.validated_data["action"],
                actor=request.user,
                comment=payload.validated_data.get("comment", ""),
                expected_revision=expected,
            )
        except ContentEditConflict as error:
            raise PageEditConflict() from error
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
            "or an active database platform-administrator assignment, and an "
            "enabled PAGES module. Keycloak realm roles do not grant access."
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
        parameters=[SITE_PARAMETER, PAGE_PARAMETER, IF_MATCH],
        request=None,
        responses={200: PageSerializer, 201: PageSerializer},
        description=(
            "Open the one working draft of a published Page. The draft is "
            "copied from the current serving snapshot and edited through the "
            "normal Page workflow. The published Page stays locked and public "
            "delivery keeps that snapshot until the draft is independently "
            "approved and published. Requires an active Site AUTHOR assignment "
            "or an active database platform-administrator assignment, the "
            "PAGES module, and the published Page If-Match ETag. Keycloak "
            "realm roles do not grant access. A missing precondition returns "
            "428 and a stale ETag returns 409."
        ),
    )
    @action(detail=True, methods=["post"], url_path="working-draft")
    def working_draft(self, request, *args, **kwargs):
        site, page = self._page()
        self._authorize(site, (ContentRole.AUTHOR,))
        ensure_pages_module_enabled(site.pk)
        supplied = request.headers.get("If-Match")
        if not supplied:
            raise PreconditionRequired()
        if supplied != page_etag(page):
            raise PageEditConflict()
        try:
            draft, created = open_working_draft(page, actor=request.user, if_match=supplied)
        except ContentEditConflict as error:
            raise PageEditConflict() from error
        except DomainValidationError as error:
            detail = (
                error.message_dict if hasattr(error, "message_dict")
                else {"non_field_errors": error.messages}
            )
            raise serializers.ValidationError(detail) from error
        draft = get_object_or_404(
            Page.objects.filter(site_id=site.pk), pk=draft.pk,
        )
        response = self._response(draft, status_code=201 if created else 200)
        if created:
            response["Location"] = f"/api/v1/sites/{site.pk}/pages/{draft.pk}/"
        return response

    @extend_schema(
        methods=["GET"], tags=["CMS pages"], parameters=[SITE_PARAMETER, PAGE_PARAMETER],
        responses=PageSerializer,
        description="Reload this Site-owned Page, including its complete visual tree or unchanged legacy blocks, revision number and strong ETag. Does not create a draft. For a published Page, open its working-draft first and edit the returned draft ID.",
    )
    @extend_schema(
        methods=["PATCH"], tags=["CMS pages"], parameters=[SITE_PARAMETER, PAGE_PARAMETER, IF_MATCH],
        request={"application/json":VISUAL_DRAFT_REQUEST_SCHEMA},
        responses={200:PageSerializer,400:VisualDraftErrorSerializer,
                   409:OpenApiResponse(description="Stale Page ETag. No tree, revision or reference changes were committed."),
                   428:OpenApiResponse(description="If-Match is required.")},
        examples=[OpenApiExample("Complete visual draft", request_only=True, value={"visual_layout":{"schema_version":1,"rows":[{"id":"main","type":"section","ratios":[100],"columns":[{"id":"main-column","type":"column","children":[{"id":"title","type":"headline","props":{"level":2,"text":"Welcome"}}]}]}]}})],
        description="Replace the complete body of a draft/unpublished Page with a visual tree. Requires an active Site AUTHOR grant and enabled PAGES and VISUAL_BUILDER modules. The exact If-Match is checked under the CMS write lock before layout/media validation. Payload, immutable revision and nested media inventory commit atomically. Legacy flat blocks are cleared from this draft's active body and remain in history/public snapshots. Other Page metadata and the public snapshot are unchanged. Validation returns fields plus node/item-position bindings. Stale writes return 409 without automatic merging or retry.",
    )
    @action(detail=True, methods=["get","patch"], url_path="visual-draft")
    def visual_draft(self, request, *args, **kwargs):
        site, page = self._page()
        ensure_pages_module_enabled(site.pk)
        ensure_visual_builder_module_enabled(site.pk)
        if request.method == "GET":
            return self._response(page)
        self._authorize(site, (ContentRole.AUTHOR,))
        supplied = request.headers.get("If-Match")
        if not supplied:
            raise PreconditionRequired()
        payload = VisualDraftInput(data=request.data)
        try:
            payload.is_valid(raise_exception=True)
        except serializers.ValidationError as error:
            fields = {key:[str(message) for message in messages] for key,messages in error.detail.items()}
            layout = request.data.get("visual_layout") if isinstance(request.data, dict) else None
            raise VisualDraftValidationError(DomainValidationError(fields),layout) from error
        layout = payload.validated_data["visual_layout"]
        try:
            page = save_visual_draft(site_id=site.pk, page_id=page.pk, actor=request.user,
                                     if_match=supplied, visual_layout=layout)
        except ContentEditConflict as error:
            raise PageEditConflict() from error
        except DomainValidationError as error:
            raise VisualDraftValidationError(error, layout) from error
        except IntegrityError as error:
            raise Conflict() from error
        return self._response(page)

    @extend_schema(
        tags=["CMS pages"],
        parameters=[SITE_PARAMETER, PAGE_PARAMETER, IF_MATCH],
        request=InsertSectionTemplateInput,
        responses={
            200: PageSerializer,
            400: VisualDraftErrorSerializer,
            409: OpenApiResponse(description="Stale Page ETag. No insertion was committed."),
            428: OpenApiResponse(description="If-Match is required."),
        },
        description=(
            "Insert a same-Site ACTIVE section template into this Page draft. "
            "Clones with fresh node IDs and revalidates media. Foreign templates, "
            "retired templates, stale schema versions and unavailable media fail "
            "without partial insertion. Existing Page content is preserved when "
            "templates later change or retire."
        ),
    )
    @action(detail=True, methods=["post"], url_path="visual-draft/insert-template")
    def insert_section_template(self, request, *args, **kwargs):
        site, page = self._page()
        ensure_pages_module_enabled(site.pk)
        ensure_visual_builder_module_enabled(site.pk)
        self._authorize(site, (ContentRole.AUTHOR,))
        supplied = request.headers.get("If-Match")
        if not supplied:
            raise PreconditionRequired()
        payload = InsertSectionTemplateInput(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            page = section_template_domain.insert_section_template(
                site_id=site.pk,
                page_id=page.pk,
                template_id=payload.validated_data["template_id"],
                actor=request.user,
                if_match=supplied,
            )
        except ContentEditConflict as error:
            raise PageEditConflict() from error
        except DomainValidationError as error:
            raise VisualDraftValidationError(
                error,
                page.metadata.get("visual_layout") if isinstance(page.metadata, dict) else None,
            ) from error
        return self._response(page)

    @extend_schema(
        tags=["CMS pages"],
        parameters=[SITE_PARAMETER, PAGE_PARAMETER],
        request={"application/json": {"type": "object", "additionalProperties": False, "maxProperties": 0}},
        responses=PageSerializer,
        description=(
            "Assign an eligible same-Site published Page to Site settings. Requires "
            "sites.update and enabled PAGES. Draft, hidden and foreign Pages are "
            "rejected atomically. No Page revision is changed. Loss of publication "
            "eligibility returns the empty root fallback (404); no draft is served."
        ),
    )
    @action(detail=True, methods=["post"], url_path="homepage")
    def homepage(self, request, *args, **kwargs):
        site = self._site()
        page = get_object_or_404(self.get_queryset(), pk=self.kwargs["pk"])
        EmptyObjectSerializer(data=request.data).is_valid(raise_exception=True)
        ensure_pages_module_enabled(site.pk)
        try:
            with hierarchy_write():
                page = assign_homepage(site_id=site.pk, page_id=page.pk, actor=request.user)
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
    return content_etag(page)


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


def ensure_visual_builder_module_enabled(site_id):
    """Map a disabled VISUAL_BUILDER module to the shared validation envelope."""
    try:
        require_visual_builder_module(site_id)
    except DomainValidationError as error:
        fields = (
            error.message_dict if hasattr(error, "message_dict")
            else {"module": error.messages}
        )
        raise serializers.ValidationError({
            "reason": "module_disabled",
            "fields": fields,
        }) from error
