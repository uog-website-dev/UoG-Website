"""Controlled domain mutations. Callers still authorize the administrator."""
from contextlib import contextmanager
from contextvars import ContextVar

from django.core.exceptions import ValidationError
from django.db import DEFAULT_DB_ALIAS, connections, transaction

from ..models import SiteDomain

_reassigning = ContextVar("site_domain_reassignment", default=False)


def domain_reassignment_enabled():
    return _reassigning.get()


@contextmanager
def domain_write(*, using=DEFAULT_DB_ALIAS):
    with transaction.atomic(using=using):
        with connections[using].cursor() as cursor:
            cursor.execute("SELECT sites_lock_domains()")
        yield


@contextmanager
def _reassignment(using):
    token = _reassigning.set(True)
    try:
        with domain_write(using=using):
            with connections[using].cursor() as cursor:
                cursor.execute("SELECT set_config('sites.domain_reassignment', 'on', true)")
            yield
    finally:
        _reassigning.reset(token)


def activate_domain(domain_id, *, using=DEFAULT_DB_ALIAS):
    return _set_status(domain_id, SiteDomain.Status.ACTIVE, using=using)


def deactivate_domain(domain_id, *, using=DEFAULT_DB_ALIAS):
    return _set_status(domain_id, SiteDomain.Status.INACTIVE, using=using)


def _set_status(domain_id, status, *, using):
    with domain_write(using=using):
        domain = SiteDomain.objects.using(using).select_for_update().get(pk=domain_id)
        domain.status = status
        domain.save(using=using, update_fields=["status"])
        return domain


def designate_primary(domain_id, *, using=DEFAULT_DB_ALIAS):
    """Leave exactly one primary domain for this Site."""
    with domain_write(using=using):
        domain = SiteDomain.objects.using(using).select_for_update().get(pk=domain_id)
        SiteDomain.objects.using(using).filter(site_id=domain.site_id, is_primary=True).exclude(pk=domain.pk).update(is_primary=False)
        domain.is_primary = True
        domain.redirect_to_primary = False
        domain.save(using=using, update_fields=["is_primary", "redirect_to_primary"])
        return domain


def reassign_domain(domain_id, site_id, *, using=DEFAULT_DB_ALIAS):
    """Move a non-primary hostname onto another Site."""
    with _reassignment(using):
        domain = SiteDomain.objects.using(using).select_for_update().get(pk=domain_id)
        if domain.is_primary:
            raise ValidationError({"site": "Clear the primary designation before moving this hostname."})
        domain.site_id = site_id
        domain.save(using=using, update_fields=["site"])
        return domain
