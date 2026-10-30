"""Site-scoped API for CMS role assignments and content workflow actions."""
from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError as DomainValidationError
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, PolymorphicProxySerializer, extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.accounts.permissions import HasRealmRole
from apps.sites.api.serializers import StrictFields
from apps.sites.models import Site

from ..models import (
    ContentRole,
    Page,
    SiteContent,
    SiteContentRoleAssignment,
)
from ..services.pages import require_pages_module
from ..services.workflow import transition_content
from .serializers import PageSerializer, SiteContentSerializer


SITE_PARAMETER = OpenApiParameter(
    "site_pk", int, OpenApiParameter.PATH, description="Owning Site id.",
)


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
        ),
    )
    comment = serializers.CharField(
        required=False, allow_blank=True, max_length=5000, default="",
    )


class ContentRoleAssignmentsView(APIView):
    """Manage a Site's CMS role bindings; only validated platform admins."""

    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated, HasRealmRole]
    required_roles = {"platform-admin"}

    @extend_schema(
        tags=["CMS workflow"],
        parameters=[SITE_PARAMETER],
        responses=ContentRoleAssignmentOutput(many=True),
        description=(
            "List AUTHOR, REVIEWER and PUBLISHER assignments for this Site. "
            "Requires the validated platform-admin token role."
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
            "Only a validated platform-admin token may manage assignments."
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
            with transaction.atomic():
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
    required_roles = {"platform-admin"}

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


class ContentWorkflowActionView(APIView):
    """Perform one authorized transition for content owned by the URL Site."""

    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["CMS workflow"],
        parameters=[
            SITE_PARAMETER,
            OpenApiParameter(
                "content_id", str, OpenApiParameter.PATH,
                description="UUID of SiteContent or Page.",
            ),
        ],
        request=WorkflowActionInput,
        responses=PolymorphicProxySerializer(
            component_name="WorkflowContent",
            serializers=[PageSerializer, SiteContentSerializer],
            resource_type_field_name=None,
        ),
        description=(
            "Apply a validated content workflow action. The content must "
            "belong to the URL Site. Authorization uses Site CMS role "
            "assignments or the validated platform-admin bearer-token role; "
            "roles in the request body are ignored and rejected."
        ),
    )
    def post(self, request, site_pk, content_id):
        site = get_object_or_404(Site, pk=site_pk)
        content = get_object_or_404(
            SiteContent.objects.filter(site_id=site.pk),
            pk=content_id,
        )
        payload = WorkflowActionInput(data=request.data)
        payload.is_valid(raise_exception=True)
        claims = request.auth
        roles = getattr(claims, "roles", ())
        if not isinstance(roles, (tuple, list, set, frozenset)):
            roles = ()
        if "platform-admin" not in set(roles) and not SiteContentRoleAssignment.objects.filter(
            site_id=site.pk, user_id=request.user.pk, user__is_active=True,
        ).exists():
            raise PermissionDenied("A CMS role assigned to this Site is required.")
        if Page.objects.filter(pk=content.pk).exists():
            try:
                require_pages_module(site.pk)
            except DomainValidationError as error:
                fields = (
                    error.message_dict if hasattr(error, "message_dict")
                    else {"module": error.messages}
                )
                raise serializers.ValidationError({
                    "reason": "module_disabled",
                    "fields": fields,
                }) from error
        try:
            transitioned = transition_content(
                content.pk,
                action=payload.validated_data["action"],
                actor=request.user,
                roles=roles,
                comment=payload.validated_data.get("comment", ""),
            )
        except DomainValidationError as error:
            detail = (
                error.message_dict if hasattr(error, "message_dict")
                else {"non_field_errors": error.messages}
            )
            raise serializers.ValidationError(detail) from error

        page = Page.objects.filter(pk=transitioned.pk).first()
        if page is not None:
            return Response(PageSerializer(page).data)
        return Response(SiteContentSerializer(transitioned).data)
