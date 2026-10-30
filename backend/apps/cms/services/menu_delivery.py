"""Site-scoped menu inheritance configuration. It does not grant parent edits."""
from django.core.exceptions import ValidationError

from apps.audit.writer import record_event
from apps.sites.models import Site

from ..menu_models import LOCAL_PRECEDENCE, MenuInheritance
from .menus import _operation, authorize_menu


def inheritance_policies(site_id):
    return MenuInheritance.objects.filter(site_id=site_id).order_by("location", "id")


def set_menu_inheritance(site_id, *, actor, location, inherit_from_id, include_global, local_precedence):
    with _operation(actor):
        authorize_menu(actor, site_id, edit=True)
        if local_precedence not in LOCAL_PRECEDENCE:
            raise ValidationError({"local_precedence": "Choose override or append."})
        if inherit_from_id is not None and not Site.objects.filter(pk=inherit_from_id).exists():
            raise ValidationError({"inherit_from": "The parent Site does not exist."})
        policy = MenuInheritance.objects.filter(site_id=site_id, location=location).first()
        created = policy is None
        if created:
            policy = MenuInheritance(site_id=site_id, location=location)
            before = None
        else:
            before = {
                "site_id": policy.site_id,
                "location": policy.location,
                "inherit_from_id": policy.inherit_from_id,
                "include_global": policy.include_global,
                "local_precedence": policy.local_precedence,
            }
        policy.inherit_from_id = inherit_from_id
        policy.include_global = include_global
        policy.local_precedence = local_precedence
        policy.save()
        after = {
            "site_id": site_id,
            "location": location,
            "inherit_from_id": inherit_from_id,
            "include_global": include_global,
            "local_precedence": local_precedence,
        }
        if created or before != after:
            record_event(
                action="MENU_INHERITANCE_UPDATED",
                entity_type="cms.menu_inheritance",
                entity_id=policy.pk,
                before=before or {},
                after=after,
                changed_fields=sorted(after) if created else sorted(
                    key for key in after if before[key] != after[key]
                ),
            )
        return policy
