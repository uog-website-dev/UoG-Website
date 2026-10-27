"""Public read of the Site already selected from the request Host.

This reports routing context. It does not authenticate the caller or grant
access to another Site's records.
"""
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticatedOrReadOnly
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import Site


class ResolvedSiteSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    code = serializers.CharField()
    name = serializers.CharField()
    organization_unit = serializers.IntegerField()


class SiteContextSerializer(serializers.Serializer):
    site = ResolvedSiteSerializer(allow_null=True)
    domain = serializers.CharField(allow_null=True)
    modules = serializers.ListField(child=serializers.CharField())


class SiteContextView(APIView):
    permission_classes = [IsAuthenticatedOrReadOnly]
    serializer_class = SiteContextSerializer
    http_method_names = ["get", "head", "options"]

    @extend_schema(tags=["Sites"], responses=SiteContextSerializer, description=(
        "Site selected from the browser Host header. Platform hosts return a null site. "
        "Unknown, inactive, draft, suspended and archived hosts are rejected before this view. "
        "The response is not an authorization decision."
    ))
    def get(self, request):
        site = getattr(request, "site", None)
        if site is None:
            body = {"site": None, "domain": None, "modules": []}
        else:
            current = Site.objects.select_related("organization_unit").get(pk=site.pk)
            body = {
                "site": {
                    "id": current.pk,
                    "code": current.code,
                    "name": current.name,
                    "organization_unit": current.organization_unit_id,
                },
                "domain": request.site_domain.hostname,
                "modules": sorted(request.enabled_module_codes),
            }
        response = Response(body)
        response["Cache-Control"] = "private, no-store"
        return response
