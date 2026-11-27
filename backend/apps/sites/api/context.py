"""Public read of the Site already selected from the request Host.

This reports routing context. It does not authenticate the caller or grant
access to another Site's records.
"""
import hashlib
import json

from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticatedOrReadOnly
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import Site, SiteDomain
from .footer import FooterSettingsSerializer,public_footer
from .header import HeaderSettingsSerializer,public_header


class ResolvedSiteSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    code = serializers.CharField()
    name = serializers.CharField()
    organization_unit = serializers.IntegerField()


class PublicBannerStyleSerializer(serializers.Serializer):
    enabled = serializers.BooleanField()
    background_type = serializers.CharField()
    image_url = serializers.CharField(allow_null=True)
    pattern = serializers.CharField()
    background_color = serializers.CharField()
    overlay_color = serializers.CharField()
    overlay_opacity = serializers.FloatField()
    height = serializers.CharField()
    title_color = serializers.CharField()
    title_align = serializers.CharField()
    content_position = serializers.CharField()
    padding_y = serializers.CharField()


class PublicBannerSerializer(serializers.Serializer):
    scope = serializers.CharField()
    shared = PublicBannerStyleSerializer()
    page = PublicBannerStyleSerializer()
    post = PublicBannerStyleSerializer()


class PublicConfigurationSerializer(serializers.Serializer):
    display_name = serializers.CharField(allow_null=True)
    theme = serializers.CharField()
    logo_url = serializers.CharField(allow_null=True)
    branding_revision = serializers.CharField()
    footer = FooterSettingsSerializer()
    header = HeaderSettingsSerializer()
    languages = serializers.ListField(child=serializers.CharField())
    banner = PublicBannerSerializer()


class SiteContextSerializer(serializers.Serializer):
    site = ResolvedSiteSerializer(allow_null=True)
    domain = serializers.CharField(allow_null=True)
    canonical_domain = serializers.CharField(allow_null=True)
    configuration = PublicConfigurationSerializer(allow_null=True)
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
            body = {"site": None, "domain": None, "canonical_domain": None, "configuration": None, "modules": []}
        else:
            current = Site.objects.select_related("organization_unit").get(pk=site.pk)
            from apps.cms.api.widget_runtime import logo_asset
            from apps.sites.banner import default_banner, public_style, resolve_banner_style
            from apps.sites.configuration import normalize_site_configuration
            asset = logo_asset(current)
            configuration = normalize_site_configuration(
                current.configuration, default_language=current.default_language,
            )
            banner = configuration["presentation"].get("banner") or default_banner()
            public_identity = {
                "display_name": configuration["identity"]["display_name"],
                "theme": configuration["presentation"]["theme"],
                "logo_url": "/api/v1/site-context/identity/logo/" if asset else None,
                "banner": {
                    "scope": banner.get("scope", "shared"),
                    "shared": public_style(banner.get("shared"), image_url=_banner_image_url(banner.get("shared"))),
                    "page": public_style(
                        resolve_banner_style(banner, "page") if banner.get("scope") == "independent" else banner.get("shared"),
                        image_url=_banner_image_url(
                            resolve_banner_style(banner, "page") if banner.get("scope") == "independent" else banner.get("shared"),
                        ),
                    ),
                    "post": public_style(
                        resolve_banner_style(banner, "post") if banner.get("scope") == "independent" else banner.get("shared"),
                        image_url=_banner_image_url(
                            resolve_banner_style(banner, "post") if banner.get("scope") == "independent" else banner.get("shared"),
                        ),
                    ),
                },
            }
            # Hash only public identity and opaque media identity; no storage keys.
            revision = hashlib.sha256(json.dumps([
                current.pk, current.name, public_identity,
                str(asset.pk) if asset else None,
                asset.updated_at.isoformat() if asset else None,
                sorted(request.enabled_module_codes),
            ], sort_keys=True, default=str).encode()).hexdigest()
            public_identity["branding_revision"] = revision
            public_identity["footer"] = public_footer(current)
            public_identity["header"] = public_header(current)
            from apps.sites.events import public_event_settings_payload
            events = public_event_settings_payload(current)
            if events is not None:
                public_identity["events"] = events
            public_identity["languages"] = list(configuration["language"]["enabled"])
            body = {
                "site": {
                    "id": current.pk,
                    "code": current.code,
                    "name": current.name,
                    "organization_unit": current.organization_unit_id,
                },
                "domain": request.site_domain.hostname if request.site_domain else None,
                "canonical_domain": SiteDomain.objects.filter(
                    site=current, is_primary=True, status="ACTIVE",
                ).values_list("hostname", flat=True).first(),
                "configuration": public_identity,
                "modules": sorted(request.enabled_module_codes),
            }
        response = Response(body)
        response["Cache-Control"] = "private, no-store"
        response["Vary"] = "Host"
        return response

    @staticmethod
    def _logo_url(site):
        from apps.cms.api.widget_runtime import logo_asset
        return "/api/v1/site-context/identity/logo/" if logo_asset(site) else None


def _banner_image_url(style):
    if not isinstance(style, dict) or style.get("background_type") != "image":
        return None
    reference = style.get("image_ref")
    if not isinstance(reference, str) or not reference.strip():
        return None
    from uuid import UUID
    try:
        asset_id = str(UUID(reference))
    except (TypeError, ValueError, AttributeError):
        return None
    return f"/api/v1/site-context/media/{asset_id}/?variant=display"
