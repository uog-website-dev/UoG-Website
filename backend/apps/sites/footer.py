"""Typed footer settings and transactional Site-scoped maintenance."""
import re
from urllib.parse import urlsplit
from django.core.exceptions import PermissionDenied,ValidationError
from apps.authorization.access import effective_scope_for_site
from apps.authorization.services import permission_granted
from apps.organizations.hierarchy_lock import hierarchy_write
from apps.audit.context import audit_context,current_audit_context
from .models.footer import SiteFooter,FOOTER_FIELDS,COPYRIGHT_DEFAULT
from .models import Site

SOCIAL_PLATFORMS=("x","youtube","facebook","linkedin","telegram","tiktok","instagram")

def defaults():
    return {"newsletter_label":"","newsletter_url":"","support_label":"","support_url":"","description":"","address":"","email":"","phone":"","links_heading":"Explore","highlight_label":"","highlight_url":"","copyright_text":COPYRIGHT_DEFAULT,"social_links":[]}

def validate_link(value,*,https_only=False):
    from apps.cms.menu_models import validate_external_url
    validate_external_url(value)
    if https_only and urlsplit(value).scheme.lower()!="https":
        raise ValidationError("Use an HTTPS social profile URL.")

def validate_footer(values):
    errors={}
    for field in FOOTER_FIELDS:
        if field=="social_links":continue
        value=values.get(field)
        if not isinstance(value,str) or any(ord(c)<32 and c not in "\n\r\t" for c in value):errors[field]="Enter plain text."
    if values.get("highlight_url"):
        try:validate_link(values["highlight_url"])
        except ValidationError:errors["highlight_url"]="Use a safe HTTP or HTTPS URL."
        if not values.get("highlight_label","").strip():errors["highlight_label"]="Add a label for the featured link."
    for prefix in ("newsletter","support"):
        if values.get(prefix+"_url"):
            try:validate_link(values[prefix+"_url"],https_only=True)
            except ValidationError:errors[prefix+"_url"]="Use an approved HTTPS destination."
            if not values.get(prefix+"_label","").strip():errors[prefix+"_label"]="Add an accessible link label."
    text=values.get("copyright_text","")
    if isinstance(text,str) and any(token not in ("{year}","{site}") for token in re.findall(r"\{[^}]*\}",text)):
        errors["copyright_text"]="Only {year} and {site} placeholders are supported."
    social=values.get("social_links")
    if not isinstance(social,list) or len(social)>len(SOCIAL_PLATFORMS):errors["social_links"]="Choose at most seven social profiles."
    else:
        seen=set()
        for index,item in enumerate(social):
            key=f"social_links.{index}"
            if not isinstance(item,dict) or set(item)!={"platform","url"} or item.get("platform") not in SOCIAL_PLATFORMS:
                errors[key]="Choose a supported social platform and URL.";continue
            if item["platform"] in seen:errors[key+".platform"]="This platform is already configured."
            seen.add(item["platform"])
            try:
                if not isinstance(item["url"],str) or len(item["url"])>2048:raise ValidationError("URL length")
                validate_link(item["url"],https_only=True)
            except ValidationError:errors[key+".url"]="Use a safe HTTPS social profile URL."
    if errors:raise ValidationError(errors)

def footer_values(row):
    return {field:getattr(row,field) for field in FOOTER_FIELDS} if row else defaults()

def footer_etag(site_id,row):
    return f'"site-footer-{site_id}-v{row.version if row else 0}"'

class FooterPreconditionRequired(Exception):pass
class FooterConflict(Exception):pass

def save_footer(site_id,changes,*,actor,expected):
    if set(changes)-set(FOOTER_FIELDS):raise ValidationError({"fields":"Unsupported footer fields."})
    with hierarchy_write():
        site=Site.objects.select_for_update().get(pk=site_id)
        if not actor or not actor.is_authenticated or not actor.is_active or not permission_granted(actor,"sites.update",site_id=site.pk,organization_id=effective_scope_for_site(site.pk),audit=False):
            raise PermissionDenied("Site settings permission is required.")
        row=SiteFooter.objects.select_for_update().filter(site=site).first()
        if not expected:raise FooterPreconditionRequired()
        if expected!=footer_etag(site.pk,row):raise FooterConflict()
        values={**footer_values(row),**changes};validate_footer(values)
        if row and values==footer_values(row):return row
        context=current_audit_context()
        with audit_context(actor_kind="USER",actor_id=str(actor.pk),request_id=context.request_id):
            if row is None:row=SiteFooter(site=site,created_by=actor)
            for field,value in values.items():setattr(row,field,value)
            row.updated_by=actor;row.save()
        return row
