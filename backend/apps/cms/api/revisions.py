"""Site-scoped revision history and restore endpoints."""
from django.core.exceptions import ValidationError as DomainValidationError
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import APIException, NotFound
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.authorization.access import reject_disabled_module
from apps.sites.api.serializers import StrictFields
from apps.sites.models import Site

from ..models import (
    ContentEditConflict,
    ContentRole,
    ContentRevision,
    SiteContent,
    SiteContentRoleAssignment,
)
from ..services.revisions import (
    authorize_revision_access,
    restore_content_revision,
)


SITE_PARAMETER = OpenApiParameter(
    "site_pk", int, OpenApiParameter.PATH, description="Owning Site id.",
)
CONTENT_PARAMETER = OpenApiParameter(
    "content_id", str, OpenApiParameter.PATH,
    description="UUID of SiteContent or Page.",
)
IF_MATCH = OpenApiParameter(
    "If-Match", str, OpenApiParameter.HEADER, required=True,
    description="Current ETag returned by the revision-list endpoint.",
)


class ContentRevisionListSerializer(serializers.ModelSerializer):
    editor = serializers.CharField(
        source="editor_identity", read_only=True, allow_blank=True,
    )

    class Meta:
        model = ContentRevision
        fields = (
            "revision_number", "editor", "status", "changed_fields",
            "content_hash", "restored_from_revision", "created_at",
        )
        read_only_fields = fields


class ContentRevisionDetailSerializer(ContentRevisionListSerializer):
    class Meta(ContentRevisionListSerializer.Meta):
        fields = (*ContentRevisionListSerializer.Meta.fields, "snapshot")


class ContentRevisionPageSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    next = serializers.URLField(allow_null=True)
    previous = serializers.URLField(allow_null=True)
    results = ContentRevisionListSerializer(many=True)


class EmptyRestoreInput(StrictFields, serializers.Serializer):
    pass


class ContentRevisionPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class ContentRevisionListView(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    pagination_class = ContentRevisionPagination

    @extend_schema(
        operation_id="cms_content_revisions_list",
        tags=["CMS workflow"],
        parameters=[
            SITE_PARAMETER,
            CONTENT_PARAMETER,
            OpenApiParameter("page", int),
            OpenApiParameter("page_size", int),
        ],
        responses=ContentRevisionPageSerializer,
        description=(
            "List immutable revisions in descending version order. Requires "
            "an active AUTHOR, REVIEWER or PUBLISHER assignment on this Site, "
            "or a validated platform-admin token role. The response ETag is "
            "the current content revision and is required to restore."
        ),
    )
    def get(self, request, site_pk, content_id):
        content = _scoped_content(site_pk, content_id)
        _authorize(request, content.site_id)
        queryset = ContentRevision.objects.filter(
            site_id=content.site_id, content_id=content.pk,
        ).order_by("-revision_number")
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        serializer = ContentRevisionListSerializer(page, many=True)
        response = paginator.get_paginated_response(serializer.data)
        response["ETag"] = content_etag(content)
        response["Cache-Control"] = "private, no-store"
        return response


class ContentRevisionDetailView(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="cms_content_revision_detail",
        tags=["CMS workflow"],
        parameters=[
            SITE_PARAMETER,
            CONTENT_PARAMETER,
            OpenApiParameter("revision_number", int, OpenApiParameter.PATH),
        ],
        responses=ContentRevisionDetailSerializer,
        description=(
            "Inspect an immutable prior snapshot and its diff metadata. "
            "History is scoped to the URL Site."
        ),
    )
    def get(self, request, site_pk, content_id, revision_number):
        content = _scoped_content(site_pk, content_id)
        _authorize(request, content.site_id)
        revision = get_object_or_404(
            ContentRevision.objects.filter(
                site_id=content.site_id, content_id=content.pk,
            ),
            revision_number=revision_number,
        )
        response = Response(ContentRevisionDetailSerializer(revision).data)
        response["ETag"] = content_etag(content)
        response["Cache-Control"] = "private, no-store"
        return response


class ContentRevisionRestoreView(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="cms_content_revision_restore",
        tags=["CMS workflow"],
        parameters=[
            SITE_PARAMETER,
            CONTENT_PARAMETER,
            OpenApiParameter("revision_number", int, OpenApiParameter.PATH),
            IF_MATCH,
        ],
        request=EmptyRestoreInput,
        responses=ContentRevisionDetailSerializer,
        description=(
            "Restore the selected snapshot into a new DRAFT revision. Requires "
            "AUTHOR on this Site or platform-admin and the current content "
            "ETag from the revision list. A stale ETag returns 409. Published "
            "and reviewed content must first follow its workflow back to an "
            "editable state; historical snapshots are never modified."
        ),
    )
    def post(self, request, site_pk, content_id, revision_number):
        content = _scoped_content(site_pk, content_id)
        _authorize(request, content.site_id, author_only=True)
        EmptyRestoreInput(data=request.data).is_valid(raise_exception=True)
        supplied = request.headers.get("If-Match")
        if not supplied:
            raise ContentRestorePreconditionRequired()
        if supplied != content_etag(content):
            raise ContentRestoreConflict({
                "revision": [
                    "Content changed. Retrieve revision history and retry "
                    "with its current ETag."
                ],
            })
        claims = request.auth
        roles = getattr(claims, "roles", ())
        if not isinstance(roles, (tuple, list, set, frozenset)):
            roles = ()
        try:
            restored, source = restore_content_revision(
                content.pk,
                revision_number,
                actor=request.user,
                roles=roles,
                expected_revision=content.revision_number,
            )
        except ContentEditConflict as error:
            raise ContentRestoreConflict({
                "revision": ["Content changed during restore; retrieve history and retry."],
            }) from error
        except ContentRevision.DoesNotExist as error:
            raise NotFound("The requested revision does not exist.") from error
        except DomainValidationError as error:
            detail = (
                error.message_dict if hasattr(error, "message_dict")
                else {"non_field_errors": error.messages}
            )
            raise serializers.ValidationError(detail) from error

        revision = ContentRevision.objects.filter(
            content_id=restored.pk,
            restored_from_revision=source.revision_number,
        ).order_by("-revision_number").first()
        if revision is None:
            raise ContentRevision.DoesNotExist
        response = Response(ContentRevisionDetailSerializer(revision).data)
        response["ETag"] = content_etag(restored)
        response["Cache-Control"] = "private, no-store"
        return response


class ContentRestoreConflict(APIException):
    status_code = 409
    default_detail = "Content changed. Retrieve revision history and reconcile."


class ContentRestorePreconditionRequired(APIException):
    status_code = 428
    default_detail = "Supply the current content ETag in If-Match."


def _scoped_content(site_pk, content_id):
    get_object_or_404(Site, pk=site_pk)
    # A Site that has PAGES disabled cannot manage its Page history.
    reject_disabled_module(site_pk, "PAGES")
    return get_object_or_404(
        SiteContent.objects.select_related("site").filter(site_id=site_pk),
        pk=content_id,
    )


def _authorize(request, site_id, *, author_only=False):
    claims = request.auth
    roles = getattr(claims, "roles", ())
    if not isinstance(roles, (tuple, list, set, frozenset)):
        roles = ()
    if author_only and "platform-admin" not in set(roles):
        if not SiteContentRoleAssignment.objects.filter(
            site_id=site_id,
            user_id=request.user.pk,
            role=ContentRole.AUTHOR,
            user__is_active=True,
        ).exists():
            from django.core.exceptions import PermissionDenied
            raise PermissionDenied(
                "The AUTHOR role is required to restore content."
            )
    else:
        authorize_revision_access(
            request.user, site_id=site_id, roles=roles,
        )
    return roles


def content_etag(content):
    return f'"cms-content-{content.pk}-r{content.revision_number}"'
