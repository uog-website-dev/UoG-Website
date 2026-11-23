"""Header settings share Site RBAC and the existing published menu resolver."""
from rest_framework import serializers

from ..header import defaults, header_values
from ..models import SiteHeader
from .serializers import StrictFields


class HeaderSettingsSerializer(StrictFields, serializers.Serializer):
    brand_href = serializers.CharField(max_length=2048, required=False)
    search_enabled = serializers.BooleanField(required=False)
    sticky = serializers.BooleanField(required=False)
    cta_label = serializers.CharField(max_length=120, allow_blank=True, required=False)
    cta_url = serializers.CharField(max_length=2048, allow_blank=True, required=False)
    language_switcher = serializers.BooleanField(required=False)


class HeaderBrandingSerializer(serializers.Serializer):
    name = serializers.CharField()
    theme = serializers.ChoiceField(choices=("institutional", "high-contrast"))
    logo_asset_id = serializers.UUIDField(allow_null=True)


class HeaderMenusSerializer(serializers.Serializer):
    header = serializers.ListField(child=serializers.DictField())
    utility = serializers.ListField(child=serializers.DictField())


class MenuSlotStateSerializer(serializers.Serializer):
    published = serializers.CharField(allow_null=True)
    draft = serializers.CharField(allow_null=True)
    is_published = serializers.BooleanField()
    has_changes = serializers.BooleanField()


class HeaderMenuStateSerializer(serializers.Serializer):
    header = MenuSlotStateSerializer()
    utility = MenuSlotStateSerializer()


class HeaderEnvelopeSerializer(serializers.Serializer):
    site = serializers.IntegerField()
    version = serializers.IntegerField()
    settings = HeaderSettingsSerializer()
    menus = HeaderMenusSerializer()
    menu_state = HeaderMenuStateSerializer()
    site_origin = serializers.CharField(allow_null=True)
    modules = serializers.ListField(child=serializers.CharField())
    branding = HeaderBrandingSerializer()

def _menu_state(site_id):
    """Read-only view of the existing menu assignment drafts; never a writer."""
    from apps.cms.menu_assignment_models import MenuLocationAssignment
    rows = {
        row.location: row
        for row in MenuLocationAssignment.objects.filter(
            site_id=site_id, location__in=("header", "secondary"),
        ).select_related("draft_menu", "published_menu")
    }

    def slot(location):
        row = rows.get(location)
        draft = row.draft_menu.name if row and row.draft_menu else None
        published = row.published_menu.name if row and row.published_menu else None
        return {
            "published": published,
            "draft": draft,
            "is_published": bool(row and row.is_published),
            "has_changes": bool(row and (not row.is_published or row.draft_menus != row.published_menus or draft != published)),
        }

    return {"header": slot("header"), "utility": slot("secondary")}


def public_header(site):
    # No row is created by a read; Sites keep the safe default header.
    row = SiteHeader.objects.filter(site_id=site.pk).first()
    return header_values(row)


def header_envelope(site, row):
    from apps.cms.menu_destinations import menu_origin
    from apps.cms.selectors.menu_delivery import compose_location
    from apps.cms.api.widget_runtime import logo_asset
    from apps.sites.selectors.modules import module_is_available

    asset = logo_asset(site)
    branding = {
        "name": site.configuration["identity"]["display_name"] or site.name,
        "theme": site.configuration["presentation"]["theme"],
        "logo_asset_id": str(asset.pk) if asset else None,
    }
    from ..selectors.modules import available_module_codes
    menus_enabled = module_is_available(site.pk, "MENUS")
    return {
        "branding": branding,
        "site": site.pk,
        "version": row.version if row else 0,
        "settings": header_values(row),
        # Published menus only: previewing a draft menu is the Menus screen's job.
        "menus": {
            "header": compose_location(site.pk, "header") if menus_enabled else [],
            "utility": compose_location(site.pk, "secondary") if menus_enabled else [],
        },
        "menu_state": _menu_state(site.pk),
        "site_origin": menu_origin(site.pk),
        "modules": sorted(available_module_codes(site.pk)),
    }
