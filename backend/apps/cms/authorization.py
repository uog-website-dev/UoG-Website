"""CMS authorization from persisted grants.

Keycloak authenticates the caller. A realm role, Django staff flag, or
superuser flag never authorizes a CMS operation. The only platform-wide CMS
grant is an active ``platform-administrator`` database assignment. Every other
caller needs a live canonical Site membership on the Site that owns the
resource. Memberships are evaluated on every call;
they are never copied into a second grant table.
"""
from django.core.exceptions import PermissionDenied

from apps.authorization.access import is_platform_administrator, live_assignments
from apps.authorization.services import record_decision

from .models import ContentRole


def cms_grant_allows(actor, site_id, required_roles, *, using=None):
    """Return whether persisted grants cover this Site operation."""
    if not getattr(actor, "is_authenticated", False) or not getattr(actor, "is_active", False):
        return False
    if is_platform_administrator(actor):
        return True
    required_roles = set(required_roles)
    membership_roles = {"site-administrator"} if required_roles & set(ContentRole.values) else set()
    for cms_role, membership in (
        (ContentRole.AUTHOR,"editor"),
        (ContentRole.REVIEWER,"reviewer"),
        (ContentRole.PUBLISHER,"publisher"),
    ):
        if cms_role in required_roles:
            membership_roles.add(membership)
    # The all-role check is the existing read contract, also used by history,
    # preview and template browsing. Viewer membership grants no write role.
    if set(ContentRole.values) <= required_roles:
        membership_roles.add("viewer")
    assignments = live_assignments(actor)
    if using is not None:
        assignments = assignments.using(using)
    if assignments.filter(scope="SITE",site_id=site_id,role__is_system=True,role__code__in=membership_roles).exists():
        return True
    return False


def require_cms_grant(
    actor, site_id, required_roles, *, using=None, request=None, message=None,
):
    """Deny when no persisted CMS or platform grant covers the Site."""
    if cms_grant_allows(actor, site_id, required_roles, using=using):
        return
    if getattr(actor, "is_authenticated", False):
        record_decision(
            user=actor,
            action="CMS_AUTHORIZE",
            outcome="DENY",
            permission_code="cms.site_role",
            resource_type="site",
            resource_id=site_id,
            site_id=site_id,
            request=request,
            details={"required_roles": [str(role) for role in required_roles]},
        )
    raise PermissionDenied(
        message or "A CMS role assigned to this Site is required."
    )
