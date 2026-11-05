"""Turn a shipped module on or off for one Site. The row is kept either way."""
from django.core.exceptions import ValidationError
from django.db import DEFAULT_DB_ALIAS
from apps.organizations.hierarchy_lock import hierarchy_write

from ..models import Site, SiteModule


def _reject_blocked_switch(site_id, module, action, *, using):
    from .module_bulk import dependency_blockers

    if Site.objects.using(using).filter(pk=site_id, status=Site.Status.ARCHIVED).exists():
        raise ValidationError({"site": "Archived Sites are frozen. Restore the Site before changing its modules."})
    reasons = dependency_blockers(site_id, module, action, using=using)
    if reasons:
        names = ", ".join(sorted({reason["module"] for reason in reasons}))
        if action == "ENABLE":
            raise ValidationError({"module": f"Enable {names} for this Site first. {module.code} requires it."})
        raise ValidationError({"module": f"{names} requires {module.code} on this Site. Disable {names} first."})


def enable_module_for_site(site_id, module_id, *, configuration=None, operation=None, using=DEFAULT_DB_ALIAS):
    with hierarchy_write(using=using):
        return _enable(site_id, module_id, configuration=configuration, operation=operation, using=using)


def _audit(row, before, after, operation, *, using):
    from .module_bulk import record_site_module_change
    record_site_module_change(row.site_id, row.module, before, after, operation=operation,
                              scope_type=operation.scope_type if operation else "SITE",
                              reason=operation.reason if operation else "", using=using)


def _enable(site_id, module_id, *, configuration, operation, using):
    enablement = SiteModule.objects.using(using).select_related("module").filter(site_id=site_id, module_id=module_id).first()
    before = "NOT_ASSIGNED" if enablement is None else "ENABLED" if enablement.is_enabled else "DISABLED"
    if enablement is None:
        enablement = SiteModule(site_id=site_id, module_id=module_id, is_enabled=True)
        _reject_blocked_switch(site_id, enablement.module, "ENABLE", using=using)
    else:
        if not enablement.is_enabled:
            _reject_blocked_switch(site_id, enablement.module, "ENABLE", using=using)
        enablement.is_enabled = True
    if configuration is not None:
        enablement.configuration = configuration
    enablement.save(using=using)
    if before != "ENABLED":
        _audit(enablement, before, "ENABLED", operation, using=using)
    return enablement


def disable_module_for_site(site_id, module_id, *, operation=None, using=DEFAULT_DB_ALIAS):
    with hierarchy_write(using=using):
        return _disable(site_id, module_id, operation=operation, using=using)


def _disable(site_id, module_id, *, operation, using):
    enablement = SiteModule.objects.using(using).select_related("module").get(site_id=site_id, module_id=module_id)
    changed = enablement.is_enabled
    if changed:
        _reject_blocked_switch(site_id, enablement.module, "DISABLE", using=using)
    enablement.is_enabled = False
    enablement.save(using=using, update_fields=["is_enabled"])
    if changed:
        _audit(enablement, "ENABLED", "DISABLED", operation, using=using)
    return enablement
