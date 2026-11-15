"""Authenticated non-mutating catalogue and template preparation."""
from django.core.exceptions import ValidationError as DomainValidationError
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.sites.api.serializers import StrictFields
from apps.sites.models import Site
from ..authorization import require_cms_grant
from ..models import ContentRole
from ..homepage_templates import catalogue, prepare_template
from .pages import SITE_PARAMETER
from .visual_drafts import VisualLayoutField


class HomepageTemplateOutput(serializers.Serializer):
    manifest_version = serializers.IntegerField()
    id = serializers.CharField()
    version = serializers.IntegerField()
    name = serializers.CharField()
    description = serializers.CharField()
    required_modules = serializers.ListField(child=serializers.CharField())
    layout = VisualLayoutField(allow_null=True)
    available = serializers.BooleanField()
    unavailable_reasons = serializers.ListField(child=serializers.CharField())


class PrepareInput(StrictFields, serializers.Serializer):
    template_id = serializers.SlugField(max_length=80)
    version = serializers.IntegerField(min_value=1)


class PrepareOutput(serializers.Serializer):
    template_id = serializers.CharField()
    template_version = serializers.IntegerField()
    visual_layout = VisualLayoutField()


class HomepageTemplateCatalogue(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    def authorize(self, request, site_pk):
        site = get_object_or_404(Site, pk=site_pk)
        require_cms_grant(request.user, site.pk, (ContentRole.AUTHOR,), request=request)
        if request.query_params:
            raise ValidationError({"query": "This endpoint accepts no query parameters."})
        return site

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        response["Vary"] = "Authorization, Cookie"
        response["X-Robots-Tag"] = "noindex, nofollow"
        return response

    @extend_schema(tags=["Homepage templates"], parameters=[SITE_PARAMETER], responses=HomepageTemplateOutput(many=True))
    def get(self, request, site_pk):
        site = self.authorize(request, site_pk)
        return Response(HomepageTemplateOutput(catalogue(site.pk), many=True).data)


class HomepageTemplatePrepare(HomepageTemplateCatalogue):
    http_method_names = ["post", "options"]

    @extend_schema(tags=["Homepage templates"], parameters=[SITE_PARAMETER], request=PrepareInput, responses=PrepareOutput,
                   description="Prepare a fresh validated builder document. Does not create/save/publish a Page or assign a homepage. Save through the existing concurrency-checked Page visual-draft API.")
    def post(self, request, site_pk):
        site = self.authorize(request, site_pk)
        payload = PrepareInput(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            result = prepare_template(site.pk, payload.validated_data["template_id"], payload.validated_data["version"])
        except DomainValidationError as error:
            raise ValidationError(error.message_dict) from error
        return Response(PrepareOutput(result).data)
