"""CMS authorization from persisted grants.

Keycloak authenticates the caller. A realm role, Django staff flag, or
superuser flag never authorizes a CMS operation. The only platform-wide CMS
grant is an active ``platform-administrator`` database assignment. Every other
caller needs a live ``SiteContentRoleAssignment`` on the Site that owns the
resource.
"""
from django.core.exceptions import PermissionDenied

from apps.authorization.access import is_platform_administrator
from apps.authorization.services import record_decision

from .models import SiteContentRoleAssignment


def cms_grant_allows(actor, site_id, required_roles, *, using=None):
    """Return whether persisted grants cover this Site operation."""
    if not getattr(actor, "is_authenticated", False) or not getattr(actor, "is_active", False):
        return False
    if is_platform_administrator(actor):
        return True
    queryset = SiteContentRoleAssignment.objects
    if using is not None:
        queryset = queryset.using(using)
    return queryset.filter(
        site_id=site_id,
        user_id=actor.pk,
        role__in=required_roles,
        user__is_active=True,
    ).exists()


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
