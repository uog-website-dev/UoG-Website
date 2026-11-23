"""Footer settings share Site RBAC and the existing published menu resolver."""
from rest_framework import serializers

from .serializers import StrictFields
from ..footer import (
    apply_footer_column_copy, editor_footer_columns, footer_has_unpublished_changes,
    footer_values, published_footer_values,
)
from ..models import SiteFooter


class SocialLinkSerializer(StrictFields, serializers.Serializer):
    platform = serializers.ChoiceField(choices=("x", "youtube", "facebook", "linkedin", "telegram", "tiktok", "instagram"))
    url = serializers.CharField(max_length=2048)


class FooterColumnSerializer(StrictFields, serializers.Serializer):
    menu = serializers.CharField(max_length=36, allow_null=True, required=False)
    heading = serializers.CharField(max_length=80)
    description = serializers.CharField(max_length=300, allow_blank=True, required=False)


class FooterSettingsSerializer(StrictFields, serializers.Serializer):
    newsletter_label = serializers.CharField(max_length=120, allow_blank=True, required=False)
    newsletter_url = serializers.CharField(max_length=2048, allow_blank=True, required=False)
    support_label = serializers.CharField(max_length=120, allow_blank=True, required=False)
    support_url = serializers.CharField(max_length=2048, allow_blank=True, required=False)
    description = serializers.CharField(max_length=600, allow_blank=True, required=False)
    address = serializers.CharField(max_length=300, allow_blank=True, required=False)
    email = serializers.EmailField(allow_blank=True, required=False)
    phone = serializers.RegexField(r"^\+?[0-9][0-9(). -]{3,47}$", max_length=48, allow_blank=True, required=False)
    links_heading = serializers.CharField(max_length=80, required=False)
    highlight_label = serializers.CharField(max_length=80, allow_blank=True, required=False)
    highlight_url = serializers.CharField(max_length=2048, allow_blank=True, required=False)
    copyright_text = serializers.CharField(max_length=300, required=False)
    social_links = SocialLinkSerializer(many=True, max_length=7, required=False)
    columns = FooterColumnSerializer(many=True, max_length=4, required=False)


class FooterEditorColumnSerializer(serializers.Serializer):
    menu = serializers.CharField(allow_null=True)
    menu_name = serializers.CharField(allow_null=True)
    heading = serializers.CharField()
    description = serializers.CharField()


class LintWarningSerializer(serializers.Serializer):
    path = serializers.CharField()
    message = serializers.CharField()


class FooterBrandingSerializer(serializers.Serializer):
    name = serializers.CharField()
    theme = serializers.ChoiceField(choices=("institutional", "high-contrast"))
    logo_asset_id = serializers.UUIDField(allow_null=True)


class FooterEnvelopeSerializer(serializers.Serializer):
    site = serializers.IntegerField()
    version = serializers.IntegerField()
    settings = FooterSettingsSerializer()
    published_settings = FooterSettingsSerializer()
    has_unpublished_changes = serializers.BooleanField()
    published_at = serializers.DateTimeField(allow_null=True)
    previous_available = serializers.BooleanField()
    columns = FooterEditorColumnSerializer(many=True)
    menu_items = serializers.ListField(child=serializers.DictField())
    site_origin = serializers.CharField(allow_null=True)
    branding = FooterBrandingSerializer()
    lint_warnings = LintWarningSerializer(many=True, required=False)


def public_footer(site):
    # No row is created for a read. Draft values never reach visitors.
    row = SiteFooter.objects.filter(site_id=site.pk).first()
    return published_footer_values(row)


def footer_envelope(site, row, *, lint_warnings=()):
    from apps.cms.selectors.menu_delivery import compose_location
    from apps.cms.menu_destinations import menu_origin
    from apps.sites.selectors.modules import module_is_available
    from apps.cms.api.widget_runtime import logo_asset
    asset = logo_asset(site)
    branding = {
        "name": site.configuration["identity"]["display_name"] or site.name,
        "theme": site.configuration["presentation"]["theme"],
        "logo_asset_id": str(asset.pk) if asset else None,
    }
    published = compose_location(site.pk, "footer") if module_is_available(site.pk, "MENUS") else []
    draft_items = apply_footer_column_copy(published, footer_values(row)["columns"])
    return {
        "branding": branding,
        "site": site.pk,
        "version": row.version if row else 0,
        "settings": footer_values(row),
        "published_settings": published_footer_values(row),
        "has_unpublished_changes": footer_has_unpublished_changes(row),
        "published_at": row.published_at if row else None,
        "previous_available": bool(row and isinstance(row.previous_published_settings, dict)),
        "columns": editor_footer_columns(row, published),
        "menu_items": draft_items,
        "site_origin": menu_origin(site.pk),
        "lint_warnings": list(lint_warnings),
    }
