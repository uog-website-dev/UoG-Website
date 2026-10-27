"""Apply an allowlisted configuration change to one Site."""
from django.db import DEFAULT_DB_ALIAS

from apps.organizations.hierarchy_lock import hierarchy_write

from ..configuration import merge_site_configuration
from ..models import Site


def apply_site_configuration(site_id, changes, *, using=DEFAULT_DB_ALIAS):
    """Validate and persist changes for site_id without reading other Sites."""
    with hierarchy_write(using=using):
        site = Site.objects.using(using).select_for_update().get(pk=site_id)
        site.configuration = merge_site_configuration(site.configuration, changes)
        site.save(using=using, update_fields=["configuration"])
        return site
