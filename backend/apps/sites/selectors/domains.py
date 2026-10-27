"""Resolve a request hostname. Inactive domains and non-active Sites do not resolve."""
from django.core.exceptions import ValidationError

from ..hostnames import normalize_hostname
from ..models import SiteDomain


def resolve_hostname(value, *, using="default"):
    try:
        hostname = normalize_hostname(value)
    except ValidationError:
        return None
    domain = SiteDomain.objects.using(using).filter(hostname=hostname, status=SiteDomain.Status.ACTIVE, site__status="ACTIVE").select_related("site").first()
    if domain is None:
        return None
    if not domain.redirect_to_primary:
        return {"site": domain.site, "domain": domain, "redirect_hostname": None}
    primary = SiteDomain.objects.using(using).filter(site_id=domain.site_id, is_primary=True, status=SiteDomain.Status.ACTIVE).first()
    if primary is None:
        return None
    return {"site": domain.site, "domain": domain, "redirect_hostname": primary.hostname}
