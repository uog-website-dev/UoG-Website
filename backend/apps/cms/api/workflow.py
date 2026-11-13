"""Site-scoped API for CMS role assignments and content workflow actions."""
from apps.organizations.hierarchy_lock import hierarchy_write
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DomainValidationError
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, PolymorphicProxySerializer, extend_schema
from rest_framework import serializers, status
from rest_framework.exceptions import APIException
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.accounts.permissions import HasRealmRole
from apps.api.models import Post
from apps.api.serializers import PostSerializer
from apps.authorization.access import reject_disabled_module
from apps.cms.authorization import require_cms_grant
from apps.sites.api.serializers import StrictFields
from apps.sites.api.access import PreconditionRequired
from apps.sites.models import Site

from ..models import (
    ContentRole,
    ContentEditConflict,
    ContentWorkflowTransition,
    Page,
    SiteContent,
    SiteContentRoleAssignment,
)
from ..services.workflow import transition_content
from .serializers import PageSerializer, SiteContentSerializer


SITE_PARAMETER = OpenApiParameter(
    "site_pk", int, OpenApiParameter.PATH, description="Owning Site id.",
)
VISUAL_WORKFLOW_IF_MATCH=OpenApiParameter("If-Match",str,OpenApiParameter.HEADER,required=False,
    description="Required for visual Page approve, publish and return-to-draft (revise). Echo the exact ETag from the selected private preview. Stale versions return 409.")


class WorkflowStateConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "The content workflow changed. Refresh its status and try again."
    default_code = "workflow_conflict"


class ContentRoleAssignmentInput(StrictFields, serializers.Serializer):
    user_id = serializers.IntegerField(min_value=1)
    role = serializers.ChoiceField(choices=ContentRole.choices)


class ContentRoleAssignmentOutput(serializers.ModelSerializer):
    user_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = SiteContentRoleAssignment
        fields = ("id", "site", "user_id", "role", "created_at")
        read_only_fields = fields


class WorkflowActionInput(StrictFields, serializers.Serializer):
    action = serializers.ChoiceField(
        choices=(
            "submit", "approve", "reject", "publish", "unpublish",
            "archive", "restore",
            "revise",
        ),
    )
    comment = serializers.CharField(
        required=False, allow_blank=True, max_length=5000, default="",
    )


def workflow_expected_revision(request, content, action):
    """Bind visual approval/publication to the private revision the actor read."""
    visual = "visual_layout" in content.metadata and action in {"approve","publish","revise"}
    if visual:
        role={"approve":ContentRole.REVIEWER,"publish":ContentRole.PUBLISHER,"revise":ContentRole.AUTHOR}[action]
        require_cms_grant(request.user,content.site_id,(role,),request=request)
    supplied=request.headers.get("If-Match")
    if visual and not supplied:
        raise PreconditionRequired()
    if supplied:
        from ..services.working_drafts import content_etag
        if supplied != content_etag(content):
            raise WorkflowStateConflict({"revision":["Content changed after preview. Reload the current revision."]})
        return content.revision_number
    return None


class ContentRoleAssignmentsView(APIView):
    """Manage a Site's CMS role bindings; only validated platform admins."""

    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated, HasRealmRole]

    @extend_schema(
        tags=["CMS workflow"],
        parameters=[SITE_PARAMETER],
        responses=ContentRoleAssignmentOutput(many=True),
        description=(
            "List AUTHOR, REVIEWER and PUBLISHER assignments for this Site. "
            "Requires an active database platform-administrator assignment. "
            "A Keycloak realm role does not grant this operation."
        ),
    )
    def get(self, request, site_pk):
        site = get_object_or_404(Site, pk=site_pk)
        assignments = SiteContentRoleAssignment.objects.filter(
            site=site,
        ).order_by("user_id", "role")
        return Response(ContentRoleAssignmentOutput(assignments, many=True).data)

    @extend_schema(
        tags=["CMS workflow"],
        parameters=[SITE_PARAMETER],
        request=ContentRoleAssignmentInput,
        responses={201: ContentRoleAssignmentOutput},
        description=(
            "Assign one CMS role to a local platform user on this Site. "
            "Requires an active database platform-administrator assignment. "
            "A Keycloak realm role does not grant this operation."
        ),
    )
    def post(self, request, site_pk):
        site = get_object_or_404(Site, pk=site_pk)
        payload = ContentRoleAssignmentInput(data=request.data)
        payload.is_valid(raise_exception=True)
        user = get_object_or_404(
            get_user_model().objects.filter(is_active=True),
            pk=payload.validated_data["user_id"],
        )
        try:
            with hierarchy_write():
                assignment = SiteContentRoleAssignment.objects.create(
                    site=site,
                    user=user,
                    role=payload.validated_data["role"],
                )
        except IntegrityError as error:
            raise serializers.ValidationError({
                "role": ["This user already has that role on this Site."],
            }) from error
        return Response(
            ContentRoleAssignmentOutput(assignment).data,
            status=status.HTTP_201_CREATED,
        )


class ContentRoleAssignmentDetailView(APIView):
    """Revoke one assignment without crossing Site boundaries."""

    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated, HasRealmRole]

    @extend_schema(
        tags=["CMS workflow"],
        parameters=[SITE_PARAMETER],
        responses={204: None},
        description=(
            "Revoke a role assignment on this Site. A role assignment on "
            "another Site is not addressable here."
        ),
    )
    def delete(self, request, site_pk, assignment_id):
        assignment = get_object_or_404(
            SiteContentRoleAssignment,
            site_id=site_pk,
            pk=assignment_id,
        )
        assignment.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkflowHistorySerializer(serializers.ModelSerializer):
    actor = serializers.IntegerField(source="actor_id", allow_null=True, read_only=True)

    class Meta:
        model = ContentWorkflowTransition
        fields = ("id", "from_status", "to_status", "actor", "comment", "created_at", "revision", "reviewed_revision")
        read_only_fields = fields


def _content_module(content):
    if Page.objects.filter(pk=content.pk).exists():
        return "PAGES"
    if Post.objects.filter(pk=content.pk).exists():
        return "POSTS"
    return "PAGES"


def _require_workflow_reader(request, site):
    require_cms_grant(
        request.user, site.pk, ContentRole.values, request=request,
    )


class ContentWorkflowHistoryView(APIView):
    """Append-only workflow history for one Page or Post on this Site."""

    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["CMS workflow"],
        parameters=[
            SITE_PARAMETER,
            OpenApiParameter(
                "content_id", str, OpenApiParameter.PATH,
                description="UUID of SiteContent, Page or Post.",
            ),
        ],
        responses=WorkflowHistorySerializer(many=True),
        description=(
            "List workflow transitions and reviewer comments for content "
            "owned by the URL Site. Page history requires PAGES and Post "
            "history requires POSTS. A cross-Site id is not found. Scheduling "
            "is not part of this history."
        ),
    )
    def get(self, request, site_pk, content_id):
        site = get_object_or_404(Site, pk=site_pk)
        content = get_object_or_404(
            SiteContent.objects.filter(site_id=site.pk),
            pk=content_id,
        )
        reject_disabled_module(site.pk, _content_module(content), request=request)
        _require_workflow_reader(request, site)
        history = ContentWorkflowTransition.objects.filter(content_id=content.pk)
        return Response(
            WorkflowHistorySerializer(history, many=True).data,
            headers={"Cache-Control": "private, no-store"},
        )


class ContentWorkflowActionView(APIView):
    """Perform one authorized transition for content owned by the URL Site."""

    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["CMS workflow"],
        parameters=[
            VISUAL_WORKFLOW_IF_MATCH,
            SITE_PARAMETER,
            OpenApiParameter(
                "content_id", str, OpenApiParameter.PATH,
                description="UUID of SiteContent, Page or Post.",
            ),
        ],
        request=WorkflowActionInput,
        responses=PolymorphicProxySerializer(
            component_name="WorkflowContent",
            serializers=[PageSerializer, PostSerializer, SiteContentSerializer],
            resource_type_field_name=None,
        ),
        description=(
            "Apply a validated workflow action to a Page or Post owned by the "
            "URL Site. Page transitions require PAGES; Post transitions "
            "require POSTS enabled for that Site. Authorization uses the "
            "action's Site CMS role assignment or an active database "
            "platform-administrator assignment. Keycloak realm roles and "
            "body-supplied roles do not grant access. An author cannot "
            "review their own content. Publishing records an immutable "
            "snapshot, audit event and cache generation change. A repeated "
            "publish is idempotent."
        ),
    )
    def post(self, request, site_pk, content_id):
        site = get_object_or_404(Site, pk=site_pk)
        content = get_object_or_404(
            SiteContent.objects.filter(site_id=site.pk),
            pk=content_id,
        )
        # Resolve the tenant-owned object before checking module state, so a
        # cross-Site identifier always remains indistinguishable from missing.
        # Each content type is governed by its own Site module.
        reject_disabled_module(site.pk, _content_module(content), request=request)
        payload = WorkflowActionInput(data=request.data)
        payload.is_valid(raise_exception=True)
        require_cms_grant(
            request.user, site.pk, ContentRole.values, request=request,
        )
        expected = workflow_expected_revision(request,content,payload.validated_data["action"])
        try:
            transitioned = transition_content(
                content.pk,
                action=payload.validated_data["action"],
                actor=request.user,
                comment=payload.validated_data.get("comment", ""),
                expected_revision=expected,
            )
        except ContentEditConflict as error:
            raise WorkflowStateConflict({"revision":["Content changed after preview. Reload the revision."]}) from error
        except DomainValidationError as error:
            detail = (
                error.message_dict if hasattr(error, "message_dict")
                else {"non_field_errors": error.messages}
            )
            if "status" in detail:
                raise WorkflowStateConflict(detail) from error
            raise serializers.ValidationError(detail) from error

        page = Page.objects.filter(pk=transitioned.pk).first()
        if page is not None:
            from ..services.working_drafts import content_etag
            return Response(PageSerializer(page,context={"request":request}).data,headers={"ETag":content_etag(page),"Cache-Control":"private, no-store"})
        post = Post.objects.filter(pk=transitioned.pk).first()
        if post is not None:
            from ..services.working_drafts import content_etag
            return Response(PostSerializer(post, context={"request": request}).data,headers={"ETag":content_etag(post),"Cache-Control":"private, no-store"})
        from ..services.working_drafts import content_etag
        return Response(SiteContentSerializer(transitioned).data,headers={"ETag":content_etag(transitioned),"Cache-Control":"private, no-store"})
