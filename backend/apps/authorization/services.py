"""Central fail-closed authorization evaluation and audit services."""
from django.db import transaction
from django.utils import timezone

from apps.audit.context import current_audit_context

from .catalog import PLATFORM_ADMIN, capability_for
from .models import AuthorizationAuditEvent, Permission, UserRoleAssignment


@transaction.atomic
def record_decision(*, user, action, outcome, permission_code="", assignment=None,
                   role_code="", resource_type="", resource_id="", organization_id=None, site_id=None,
                   details=None, request=None):
    """Persist a bounded, secret-free authorization event."""
    context = current_audit_context()
    return AuthorizationAuditEvent.objects.create(
        actor=user if user and getattr(user, "is_authenticated", False) else None,
        action=action[:80],
        outcome=outcome,
        permission_code=permission_code[:120],
        subject_user_id=str(assignment.user_id) if assignment else "",
        role_code=assignment.role.code if assignment else role_code[:80],
        scope=assignment.scope if assignment else "",
        organization_id=str(assignment.organization_id if assignment else organization_id) if (assignment and assignment.organization_id) or organization_id else "",
        site_id=str(assignment.site_id if assignment else site_id) if (assignment and assignment.site_id) or site_id else "",
        resource_type=resource_type[:80],
        resource_id=str(resource_id)[:120] if resource_id is not None else "",
        request_id=getattr(request, "request_id", None) or context.request_id,
        details=details if isinstance(details, dict) else {},
    )


def assignment_matches(assignment, *, organization_id=None, site_id=None):
    """A broad scope can cover descendants; narrower scopes never broaden."""
    if assignment.scope == UserRoleAssignment.Scope.PLATFORM:
        return True
    if assignment.scope == UserRoleAssignment.Scope.SITE:
        return site_id is not None and assignment.site_id == site_id
    if assignment.scope != UserRoleAssignment.Scope.ORGANIZATION or organization_id is None:
        return False
    if site_id is not None:
        from apps.sites.models import Site
        owning_organization_id = Site.objects.filter(pk=site_id).values_list("organization_unit_id", flat=True).first()
        if owning_organization_id is None or owning_organization_id != organization_id:
            return False
    if assignment.organization_id == organization_id:
        return True
    from apps.organizations.selectors.hierarchy import get_ancestors
    try:
        return any(row.pk == assignment.organization_id for row in get_ancestors(organization_id, include_self=True))
    except Exception:
        return False


def permission_granted(user, permission_code, *, organization_id=None, site_id=None, request=None, audit=True):
    """Evaluate one registered active capability from database assignments.

    No token claims, Django groups, staff flags or client-supplied role names
    are authorization sources. Unknown catalog codes and unknown DB codes deny.
    """
    capability = capability_for(permission_code)
    if (not capability or not user or not getattr(user, "is_authenticated", False)
            or not getattr(user, "is_active", False)):
        if audit and user and getattr(user, "is_authenticated", False):
            record_decision(user=user, action="PERMISSION_CHECK", outcome="DENY", permission_code=permission_code, request=request)
        return False
    try:
        permission = Permission.objects.get(code=permission_code, is_active=True, is_system=True)
    except Permission.DoesNotExist:
        if audit:
            record_decision(user=user, action="PERMISSION_CHECK", outcome="DENY", permission_code=permission_code, request=request)
        return False

    # This is the only platform-wide bypass. It is an explicit, active,
    # database-backed assignment (never a Keycloak claim or Django staff flag)
    # and is recorded separately for review.
    from .access import is_platform_administrator
    if is_platform_administrator(user) and permission_code in PLATFORM_ADMIN:
        if audit:
            record_decision(user=user, action="PLATFORM_ADMIN_BYPASS", outcome="ALLOW",
                            permission_code=permission_code, organization_id=organization_id,
                            site_id=site_id, request=request)
        return True

    now = timezone.now()
    assignments = (
        UserRoleAssignment.objects.select_related("role")
        .prefetch_related("role__permission_links__permission")
        .filter(user=user, revoked_at__isnull=True, role__is_active=True)
        .filter(Q_expiry(now))
    )
    if organization_id is None and site_id is None:
        # A scope-less query is a platform-level query, not a wildcard. Only
        # platform grants (or the explicit platform-admin bypass above) apply.
        assignments = assignments.filter(scope=UserRoleAssignment.Scope.PLATFORM)
    for assignment in assignments:
        if not assignment_matches(assignment, organization_id=organization_id, site_id=site_id):
            continue
        has_permission = assignment.role.permission_links.filter(
            permission_id=permission.pk, permission__is_active=True, permission__is_system=True,
        ).exists()
        if has_permission:
            if audit:
                record_decision(user=user, action="PERMISSION_CHECK", outcome="ALLOW", permission_code=permission_code,
                                assignment=assignment, request=request)
            return True
    if audit:
        record_decision(user=user, action="PERMISSION_CHECK", outcome="DENY", permission_code=permission_code, request=request)
    return False


def Q_expiry(now):
    from django.db.models import Q
    return Q(expires_at__isnull=True) | Q(expires_at__gt=now)


def effective_permissions(user, *, organization_id=None, site_id=None):
    """Return registered active capability codes granted at a given scope."""
    granted = []
    for permission_code in sorted(Permission.objects.filter(is_active=True, is_system=True).values_list("code", flat=True)):
        if capability_for(permission_code) and permission_granted(
            user, permission_code, organization_id=organization_id, site_id=site_id, audit=False,
        ):
            granted.append(permission_code)
    return granted


def assignment_target_scope(*, scope, organization=None, site=None):
    """Validate and normalize assignment scope for serializers/services."""
    if scope == UserRoleAssignment.Scope.PLATFORM:
        if organization is not None or site is not None:
            raise ValueError("Platform assignments cannot include an organization or site.")
        return {"scope": scope, "organization": None, "site": None}
    if scope == UserRoleAssignment.Scope.ORGANIZATION:
        if organization is None or site is not None:
            raise ValueError("Organization assignments require exactly one organization.")
        return {"scope": scope, "organization": organization, "site": None}
    if scope == UserRoleAssignment.Scope.SITE:
        if organization is None or site is None or site.organization_unit_id != organization.pk:
            raise ValueError("Site assignments require a site and its owning organization.")
        return {"scope": scope, "organization": organization, "site": site}
    raise ValueError("Unknown assignment scope.")
