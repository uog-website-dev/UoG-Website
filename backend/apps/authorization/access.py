"""Scope discovery helpers for protected API querysets and request targets."""
from django.db.models import Q
from django.utils import timezone

from .catalog import PLATFORM_ADMIN, capability_for
from .models import Permission, RolePermission, UserRoleAssignment


def live_assignments(user, permission_code=None):
    """Assignments with active roles and a live registered permission."""
    if not user or not getattr(user, "is_authenticated", False) or not getattr(user, "is_active", False):
        return UserRoleAssignment.objects.none()
    if permission_code is not None:
        capability = capability_for(permission_code)
        if capability is None:
            return UserRoleAssignment.objects.none()
        permission = Permission.objects.filter(code=permission_code, is_system=True, is_active=True).first()
        if permission is None:
            return UserRoleAssignment.objects.none()
        roles = RolePermission.objects.filter(permission=permission, role__is_active=True).values("role_id")
    else:
        roles = None
    queryset = UserRoleAssignment.objects.filter(
        user=user, revoked_at__isnull=True, role__is_active=True,
    ).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now()))
    if roles is not None:
        queryset = queryset.filter(role_id__in=roles)
    return queryset.select_related("role", "organization", "site")


def is_platform_administrator(user):
    """The sole platform bypass: active DB grant and approved capability only."""
    return live_assignments(user).filter(
        role__code="platform-administrator", role__is_system=True,
        scope=UserRoleAssignment.Scope.PLATFORM,
    ).exists()


def has_any_permission(user, permission_code):
    """Does the user hold this registered capability at any scope?"""
    if capability_for(permission_code) is None:
        return False
    from .catalog import PLATFORM_ADMIN
    return live_assignments(user, permission_code).exists() or (
        permission_code in PLATFORM_ADMIN and is_platform_administrator(user)
    )


def organization_ids_in_scope(organization_id):
    """Return an organization and descendants, with a safe self-only fallback."""
    from apps.organizations.models import OrganizationUnit
    from apps.organizations.selectors.hierarchy import get_descendants
    try:
        return [row.pk for row in get_descendants(organization_id, include_self=True)]
    except Exception:
        return list(OrganizationUnit.objects.filter(pk=organization_id).values_list("pk", flat=True))


def authorized_organization_ids(user, permission_code):
    """None means platform-wide; otherwise return accessible org subtree ids."""
    if is_platform_administrator(user) and permission_code in PLATFORM_ADMIN:
        return None
    ids = set()
    assignments = live_assignments(user, permission_code)
    if assignments.filter(scope=UserRoleAssignment.Scope.PLATFORM).exists():
        return None
    for assignment in assignments:
        if assignment.scope == UserRoleAssignment.Scope.ORGANIZATION and assignment.organization_id:
            ids.update(organization_ids_in_scope(assignment.organization_id))
    return sorted(ids)


def authorized_site_ids(user, permission_code):
    """None means platform-wide; otherwise site assignments and org descendants."""
    if is_platform_administrator(user) and permission_code in PLATFORM_ADMIN:
        return None
    from apps.sites.models import Site
    ids = set()
    assignments = live_assignments(user, permission_code)
    if assignments.filter(scope=UserRoleAssignment.Scope.PLATFORM).exists():
        return None
    for assignment in assignments:
        if assignment.scope == UserRoleAssignment.Scope.SITE and assignment.site_id:
            ids.add(assignment.site_id)
        elif assignment.scope == UserRoleAssignment.Scope.ORGANIZATION and assignment.organization_id:
            ids.update(Site.objects.filter(organization_unit_id__in=organization_ids_in_scope(assignment.organization_id)).values_list("pk", flat=True))
    return sorted(ids)


def effective_scope_for_site(site_id):
    """Resolve an existing site's owning organization; never trust client org ids."""
    from apps.sites.models import Site
    return Site.objects.filter(pk=site_id).values_list("organization_unit_id", flat=True).first()


def assignment_covers_target(assignment, *, organization_id=None, site_id=None):
    """Whether an assignment's scope contains the requested resource context."""
    if assignment.scope == UserRoleAssignment.Scope.PLATFORM:
        return True
    if assignment.scope == UserRoleAssignment.Scope.SITE:
        return site_id is not None and assignment.site_id == site_id
    if assignment.scope != UserRoleAssignment.Scope.ORGANIZATION or organization_id is None:
        return False
    if assignment.organization_id == organization_id:
        return True
    from apps.organizations.selectors.hierarchy import get_ancestors
    try:
        return any(item.pk == assignment.organization_id for item in get_ancestors(organization_id, include_self=True))
    except Exception:
        return False


def authorized_assignment_ids(user, permission_code="platform.users.assign_roles"):
    """Historical assignments visible/manageable inside the actor's live scopes."""
    if is_platform_administrator(user) and permission_code in PLATFORM_ADMIN:
        return None
    ids = set()
    for assignment in live_assignments(user, permission_code):
        if assignment.scope == UserRoleAssignment.Scope.PLATFORM:
            return None
        if assignment.scope == UserRoleAssignment.Scope.ORGANIZATION:
            org_ids = organization_ids_in_scope(assignment.organization_id)
            ids.update(UserRoleAssignment.objects.filter(
                Q(scope=UserRoleAssignment.Scope.ORGANIZATION, organization_id__in=org_ids)
                | Q(scope=UserRoleAssignment.Scope.SITE, site__organization_unit_id__in=org_ids),
            ).values_list("pk", flat=True))
        elif assignment.scope == UserRoleAssignment.Scope.SITE:
            ids.update(UserRoleAssignment.objects.filter(site_id=assignment.site_id).values_list("pk", flat=True))
    return sorted(ids)


def module_is_enabled_for_site(site_id, module_code, *, using=None):
    """Check if a module is implemented, globally enabled, and enabled for the given site.

    Returns True if the module is usable, False otherwise.
    This is a backend-only check; client-side flags should not be trusted.
    """
    from apps.sites.selectors.modules import module_is_available
    if using is None:
        using = "default"
    return module_is_available(site_id, module_code, using=using)


def reject_disabled_module(site_id, module_code, *, request=None, using="default"):
    """Return a 403/409 response if the module is disabled or unimplemented for the site.

    This is the authoritative backend gate: if the module row is missing or the
    Site has not enabled it, `enabled_modules_for_site()` returns nothing and the
    action is refused. The same validation error shape is used for every module
    action, so callers cannot tell a planned module from a disabled one by the
    HTTP status alone.
    """
    from rest_framework.exceptions import ValidationError

    if module_is_enabled_for_site(site_id, module_code):
        return None

    from apps.sites.models import Module

    module = Module.objects.filter(code=module_code).first()
    if module is None:
        raise ValidationError({"module": ["Unknown module."]})
    if module.status != Module.Status.IMPLEMENTED:
        raise ValidationError({
            "module": ["This module is not yet implemented and cannot be used."]
        })
    raise ValidationError({"module": ["This module is not enabled for this site."]})
