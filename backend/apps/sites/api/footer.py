"""Footer settings share Site RBAC and the existing published menu resolver."""
from rest_framework import serializers
from .serializers import StrictFields
from ..footer import defaults,footer_values,validate_footer
from ..models import SiteFooter

class SocialLinkSerializer(StrictFields,serializers.Serializer):
    platform=serializers.ChoiceField(choices=("x","youtube","facebook","linkedin","telegram","tiktok","instagram"))
    url=serializers.CharField(max_length=2048)

class FooterSettingsSerializer(StrictFields,serializers.Serializer):
    newsletter_label=serializers.CharField(max_length=120,allow_blank=True,required=False)
    newsletter_url=serializers.CharField(max_length=2048,allow_blank=True,required=False)
    support_label=serializers.CharField(max_length=120,allow_blank=True,required=False)
    support_url=serializers.CharField(max_length=2048,allow_blank=True,required=False)
    description=serializers.CharField(max_length=600,allow_blank=True,required=False)
    address=serializers.CharField(max_length=300,allow_blank=True,required=False)
    email=serializers.EmailField(allow_blank=True,required=False)
    phone=serializers.RegexField(r"^\+?[0-9][0-9(). -]{3,47}$",max_length=48,allow_blank=True,required=False)
    links_heading=serializers.CharField(max_length=80,required=False)
    highlight_label=serializers.CharField(max_length=80,allow_blank=True,required=False)
    highlight_url=serializers.CharField(max_length=2048,allow_blank=True,required=False)
    copyright_text=serializers.CharField(max_length=300,required=False)
    social_links=SocialLinkSerializer(many=True,max_length=7,required=False)

class FooterBrandingSerializer(serializers.Serializer):
    name=serializers.CharField()
    theme=serializers.ChoiceField(choices=("institutional","high-contrast"))
    logo_asset_id=serializers.UUIDField(allow_null=True)

class FooterEnvelopeSerializer(serializers.Serializer):
    site=serializers.IntegerField()
    version=serializers.IntegerField()
    settings=FooterSettingsSerializer()
    menu_items=serializers.ListField(child=serializers.DictField())
    site_origin=serializers.CharField(allow_null=True)
    branding=FooterBrandingSerializer()

def public_footer(site):
    # No row is created for a read. Existing Sites retain their default footer.
    row=SiteFooter.objects.filter(site_id=site.pk).first()
    return footer_values(row)

def footer_envelope(site,row):
    from apps.cms.selectors.menu_delivery import compose_location
    from apps.cms.menu_destinations import menu_origin
    from apps.sites.selectors.modules import module_is_available
    from apps.cms.api.widget_runtime import logo_asset
    asset=logo_asset(site)
    branding={"name":site.configuration["identity"]["display_name"] or site.name,"theme":site.configuration["presentation"]["theme"],"logo_asset_id":str(asset.pk) if asset else None}
    return {"branding":branding,"site":site.pk,"version":row.version if row else 0,"settings":footer_values(row),"menu_items":compose_location(site.pk,"footer") if module_is_available(site.pk,"MENUS") else [],"site_origin":menu_origin(site.pk)}
