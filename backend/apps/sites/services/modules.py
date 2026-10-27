"""Turn a shipped module on or off for one Site. The row is kept either way."""
from django.db import DEFAULT_DB_ALIAS

from ..models import SiteModule


def enable_module_for_site(site_id, module_id, *, configuration=None, using=DEFAULT_DB_ALIAS):
    enablement = SiteModule.objects.using(using).filter(site_id=site_id, module_id=module_id).first()
    if enablement is None:
        enablement = SiteModule(site_id=site_id, module_id=module_id, is_enabled=True)
    else:
        enablement.is_enabled = True
    if configuration is not None:
        enablement.configuration = configuration
    enablement.save(using=using)
    return enablement


def disable_module_for_site(site_id, module_id, *, using=DEFAULT_DB_ALIAS):
    enablement = SiteModule.objects.using(using).get(site_id=site_id, module_id=module_id)
    enablement.is_enabled = False
    enablement.save(using=using, update_fields=["is_enabled"])
    return enablement
