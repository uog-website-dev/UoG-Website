"""Internal Site lifecycle commands; authorization belongs to the caller."""
from django.db import DEFAULT_DB_ALIAS
from apps.organizations.hierarchy_lock import hierarchy_write

from ..models import Site


def transition_site(site_id, *, status, using=DEFAULT_DB_ALIAS):
    with hierarchy_write(using=using):
        site = Site.objects.using(using).get(pk=site_id)
        site.status = status
        site.save(using=using, update_fields=["status"])
        return site


def activate_site(site_id, *, using=DEFAULT_DB_ALIAS):
    return transition_site(site_id, status=Site.Status.ACTIVE, using=using)


def suspend_site(site_id, *, using=DEFAULT_DB_ALIAS):
    return transition_site(site_id, status=Site.Status.SUSPENDED, using=using)


def archive_site(site_id, *, using=DEFAULT_DB_ALIAS):
    return transition_site(site_id, status=Site.Status.ARCHIVED, using=using)
