"""Minimal, live-authorized workspace context and separately paginated discovery."""
import hashlib
import json

from django.db.models import Prefetch, Q
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.authorization.access import authorized_site_ids
from apps.authorization.services import effective_permission_sets
from apps.accounts.authentication import KeycloakBearerAuthentication
from ..models import Site, SiteDomain
from ..selectors.modules import available_module_codes
from .serializers import SiteSerializer


class StrictQuery(serializers.Serializer):
    def to_internal_value(self, data):
        errors = {key: ["Unknown query parameter."] for key in data if key not in self.fields}
        if hasattr(data, "getlist"):
            errors.update({key: ["Supply once."] for key in data if len(data.getlist(key)) != 1})
        if errors:
            raise serializers.ValidationError(errors)
        return super().to_internal_value(dict(data.items()))


class BootstrapQuery(StrictQuery):
    site = serializers.IntegerField(required=False, min_value=1, max_value=9007199254740991)


class SwitcherQuery(StrictQuery):
    search = serializers.CharField(required=False, allow_blank=True, max_length=100)
    page = serializers.IntegerField(default=1, min_value=1, max_value=1000000)
    page_size = serializers.IntegerField(default=20, min_value=1, max_value=50)


class WorkspaceChoice(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    code = serializers.CharField()
    status = serializers.CharField()


class OrganizationSummary(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class WorkspaceSite(WorkspaceChoice):
    organization = OrganizationSummary()
    defaultLanguage = serializers.CharField()
    enabledLanguages = serializers.ListField(child=serializers.CharField())
    primaryDomain = serializers.JSONField(allow_null=True)
    homepageId = serializers.UUIDField(allow_null=True)
    permissions = serializers.ListField(child=serializers.CharField())
    enabledModuleCodes = serializers.ListField(child=serializers.CharField())


class BootstrapResponse(serializers.Serializer):
    schemaVersion = serializers.IntegerField()
    version = serializers.CharField()
    platformPermissions = serializers.ListField(child=serializers.CharField())
    site = WorkspaceSite(allow_null=True)


class SwitcherResponse(serializers.Serializer):
    count = serializers.IntegerField()
    page = serializers.IntegerField()
    page_size = serializers.IntegerField()
    results = WorkspaceChoice(many=True)


class PrivateWorkspaceView(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        response["Vary"] = "Authorization, Cookie"
        return response


class WorkspaceBootstrap(PrivateWorkspaceView):
    @extend_schema(parameters=[BootstrapQuery], responses=BootstrapResponse, tags=["Workspace"],
                   description="Live scoped context; no Site enumeration. Unknown and unauthorized Sites both return 404. Version/ETag is informational: access is always revalidated, never 304.")
    def get(self, request):
        query = BootstrapQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        site_id = query.validated_data.get("site")
        site = None
        if site_id is not None:
            site = Site.objects.select_related("organization_unit").prefetch_related(Prefetch(
                "domains", queryset=SiteDomain.objects.filter(is_primary=True), to_attr="primary_domain_rows",
            )).filter(pk=site_id).first()
            if site is None:
                raise NotFound()
        scopes = [(None, None)] + ([(site.organization_unit_id, site.pk)] if site else [])
        permissions = effective_permission_sets(request.user, scopes)
        if site and "sites.view" not in permissions[1]:
            raise NotFound()
        current = None
        if site:
            serialized = SiteSerializer(site).data
            current = dict(WorkspaceChoice(site).data)
            current.update({
                "organization": {"id": site.organization_unit_id, "name": site.organization_unit.name},
                "defaultLanguage": site.default_language,
                "enabledLanguages": site.configuration["language"]["enabled"],
                "primaryDomain": serialized["primary_domain"], "homepageId": serialized["homepage"],
                "permissions": permissions[1], "enabledModuleCodes": sorted(available_module_codes(site.pk)),
            })
        payload = {"schemaVersion": 1, "platformPermissions": permissions[0], "site": current}
        version = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
        payload["version"] = version
        return Response(payload, headers={"ETag": f'"{version}"'})


class WorkspaceSites(PrivateWorkspaceView):
    @extend_schema(parameters=[SwitcherQuery], responses=SwitcherResponse, tags=["Workspace"],
                   description="Authorized Site summaries only. Search name/code; order name then ID. Page size 20, maximum 50. Discovery is separate from bootstrap.")
    def get(self, request):
        query = SwitcherQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        data = query.validated_data
        allowed = authorized_site_ids(request.user, "sites.view")
        rows = Site.objects.all() if allowed is None else Site.objects.filter(pk__in=allowed)
        if data.get("search"):
            rows = rows.filter(Q(name__icontains=data["search"]) | Q(code__icontains=data["search"]))
        rows = rows.only("id", "name", "code", "status").order_by("name", "pk")
        count = rows.count()
        offset = (data["page"] - 1) * data["page_size"]
        return Response({"count": count, "page": data["page"], "page_size": data["page_size"],
                         "results": WorkspaceChoice(rows[offset:offset + data["page_size"]], many=True).data})
