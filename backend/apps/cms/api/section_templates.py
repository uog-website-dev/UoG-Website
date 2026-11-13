"""Site-scoped visual section template API."""
from uuid import UUID

from django.core.exceptions import ValidationError as DomainValidationError
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.sites.api.serializers import StrictFields
from apps.sites.models import Site

from ..authorization import require_cms_grant
from ..models import ContentRole
from ..section_template_models import SectionTemplate, SectionTemplateStatus
from ..services import section_templates as domain
from .pages import SITE_PARAMETER, ensure_pages_module_enabled, ensure_visual_builder_module_enabled
from .visual_drafts import VisualDraftErrorSerializer, VisualDraftValidationError


TEMPLATE_PARAMETER = OpenApiParameter(
    "id", UUID, OpenApiParameter.PATH, description="Section template UUID.",
)


class SectionTemplateOutput(serializers.ModelSerializer):
    class Meta:
        model = SectionTemplate
        fields = (
            "id", "site", "name", "status", "schema_version", "version",
            "section", "created_by", "updated_by", "created_at", "updated_at",
        )
        read_only_fields = fields


class SectionTemplateCreateInput(StrictFields, serializers.Serializer):
    name = serializers.CharField(max_length=120)
    section = serializers.JSONField()


class SectionTemplatePatchInput(StrictFields, serializers.Serializer):
    name = serializers.CharField(max_length=120, required=False)
    status = serializers.ChoiceField(choices=SectionTemplateStatus.choices, required=False)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError({"non_field_errors": ["Provide a name or status change."]})
        if attrs.get("status") not in (None, SectionTemplateStatus.RETIRED, SectionTemplateStatus.ACTIVE):
            raise serializers.ValidationError({"status": "Use ACTIVE or RETIRED."})
        return attrs


class SectionTemplateViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    GenericViewSet,
):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    serializer_class = SectionTemplateOutput
    http_method_names = ["get", "post", "patch", "head", "options"]
    lookup_field = "pk"
    lookup_url_kwarg = "id"

    def get_queryset(self):
        site = self._site()
        include_retired = self.request.query_params.get("include_retired") == "true"
        return SectionTemplate.objects.filter(site_id=site.pk).order_by("-updated_at", "name") if include_retired else (
            SectionTemplate.objects.filter(site_id=site.pk, status=SectionTemplateStatus.ACTIVE).order_by("-updated_at", "name")
        )

    def _site(self):
        return get_object_or_404(Site.objects.all(), pk=self.kwargs["site_pk"])

    def _authorize(self, site, roles):
        require_cms_grant(self.request.user, site.pk, roles, request=self.request)

    @extend_schema(
        tags=["CMS section templates"],
        parameters=[SITE_PARAMETER, OpenApiParameter("include_retired", bool, OpenApiParameter.QUERY, required=False)],
        responses=SectionTemplateOutput(many=True),
        description="List Site-owned visual section templates. Requires a CMS role and enabled PAGES + VISUAL_BUILDER.",
    )
    def list(self, request, *args, **kwargs):
        site = self._site()
        ensure_pages_module_enabled(site.pk)
        ensure_visual_builder_module_enabled(site.pk)
        self._authorize(site, (ContentRole.AUTHOR, ContentRole.REVIEWER, ContentRole.PUBLISHER))
        return Response(SectionTemplateOutput(self.get_queryset(), many=True).data)

    @extend_schema(
        tags=["CMS section templates"],
        parameters=[SITE_PARAMETER, TEMPLATE_PARAMETER],
        responses=SectionTemplateOutput,
        description="Retrieve one same-Site section template.",
    )
    def retrieve(self, request, *args, **kwargs):
        site = self._site()
        ensure_pages_module_enabled(site.pk)
        ensure_visual_builder_module_enabled(site.pk)
        self._authorize(site, (ContentRole.AUTHOR, ContentRole.REVIEWER, ContentRole.PUBLISHER))
        template = get_object_or_404(SectionTemplate.objects.filter(site_id=site.pk), pk=kwargs["id"])
        return Response(SectionTemplateOutput(template).data)

    @extend_schema(
        tags=["CMS section templates"],
        parameters=[SITE_PARAMETER],
        request=SectionTemplateCreateInput,
        responses={201: SectionTemplateOutput, 400: VisualDraftErrorSerializer},
        description="Save one validated layout section as a Site-owned template. Media must be ready and same-Site.",
    )
    def create(self, request, *args, **kwargs):
        site = self._site()
        ensure_pages_module_enabled(site.pk)
        ensure_visual_builder_module_enabled(site.pk)
        self._authorize(site, (ContentRole.AUTHOR,))
        payload = SectionTemplateCreateInput(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            template = domain.create_section_template(
                site_id=site.pk,
                actor=request.user,
                name=payload.validated_data["name"],
                section=payload.validated_data["section"],
            )
        except DomainValidationError as error:
            layout = {"schema_version": 1, "rows": [payload.validated_data.get("section")]}
            raise VisualDraftValidationError(error, layout) from error
        return Response(SectionTemplateOutput(template).data, status=201)

    @extend_schema(
        tags=["CMS section templates"],
        parameters=[SITE_PARAMETER, TEMPLATE_PARAMETER],
        request=SectionTemplatePatchInput,
        responses=SectionTemplateOutput,
        description="Rename a template or retire it. Retirement does not change Pages that already inserted a clone.",
    )
    def partial_update(self, request, *args, **kwargs):
        site = self._site()
        ensure_pages_module_enabled(site.pk)
        ensure_visual_builder_module_enabled(site.pk)
        self._authorize(site, (ContentRole.AUTHOR,))
        template = get_object_or_404(SectionTemplate.objects.filter(site_id=site.pk), pk=kwargs["id"])
        payload = SectionTemplatePatchInput(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        if "name" in data:
            template.name = data["name"]
        if data.get("status") == SectionTemplateStatus.RETIRED:
            template.status = SectionTemplateStatus.RETIRED
        elif data.get("status") == SectionTemplateStatus.ACTIVE:
            template.status = SectionTemplateStatus.ACTIVE
        template.updated_by = request.user
        try:
            template.save(update_fields=["name", "status", "updated_by", "updated_at"])
        except DomainValidationError as error:
            raise serializers.ValidationError(
                error.message_dict if hasattr(error, "message_dict") else error.messages
            ) from error
        return Response(SectionTemplateOutput(template).data)
