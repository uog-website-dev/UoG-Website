"""Which registry records may be offered to a Site."""
from django.db import DEFAULT_DB_ALIAS, connections
from django.db.models import BooleanField
from django.db.models.expressions import RawSQL

from ..models import Module


def capability_is_shipped(code, *, using=DEFAULT_DB_ALIAS):
    """True only when a deployment has recorded that this code has an implementation."""
    with connections[using].cursor() as cursor:
        cursor.execute("SELECT EXISTS (SELECT 1 FROM sites_module_implementation WHERE code = %s)", [code])
        return cursor.fetchone()[0]


def module_is_usable(module, *, using=DEFAULT_DB_ALIAS):
    return bool(
        module.status == Module.Status.IMPLEMENTED
        and module.is_enabled
        and capability_is_shipped(module.code, using=using)
    )


def usable_modules(*, using=DEFAULT_DB_ALIAS):
    """Implemented and globally enabled capabilities. Planned rows are excluded."""
    shipped = RawSQL(
        "EXISTS (SELECT 1 FROM sites_module_implementation WHERE code = sites_module.code)",
        [],
        output_field=BooleanField(),
    )
    return Module.objects.using(using).filter(
        status=Module.Status.IMPLEMENTED, is_enabled=True,
    ).annotate(shipped=shipped).filter(shipped=True)


def enabled_modules_for_site(site_id, *, using=DEFAULT_DB_ALIAS):
    """Modules this Site has turned on that are still implemented and globally enabled."""
    return usable_modules(using=using).filter(site_modules__site_id=site_id, site_modules__is_enabled=True)


def available_module_codes(site_id, *, using=DEFAULT_DB_ALIAS):
    """One query for the codes the current Site may use."""
    return frozenset(enabled_modules_for_site(site_id, using=using).values_list("code", flat=True))


def module_is_available(site_id, code, *, using=DEFAULT_DB_ALIAS):
    return enabled_modules_for_site(site_id, using=using).filter(code=code).exists()


def module_available_on_request(request, code):
    """Backend checks use the codes loaded for this request, not a display flag."""
    return code in getattr(request, "enabled_module_codes", frozenset())
