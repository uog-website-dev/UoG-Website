"""DRF adapters for centralized, database-backed authorization."""
from rest_framework.exceptions import NotAuthenticated, NotFound
from rest_framework.permissions import BasePermission

from .access import (
    authorized_organization_ids,
    authorized_site_ids,
    effective_scope_for_site,
    live_assignments,
)
from .services import permission_granted, record_decision


class HasApplicationPermission(BasePermission):
    """Enforce one explicitly registered capability at its resolved scope."""
    message = "You do not have permission to perform this action."

    def has_permission(self, request, view):
        code = getattr(view, "required_permission", None)
        if not code:
            return False
        from .catalog import capability_for
        if capability_for(code) is None:
            return False

        action = getattr(view, "action", None)
        kwargs = getattr(view, "kwargs", {})
        object_pk = kwargs.get("pk")
        site_pk = kwargs.get("site_pk")
        organization_id = None
        site_id = None
        user = request.user

        if code.startswith("platform.organizations."):
            if action in {"list", "tree"}:
                allowed = authorized_organization_ids(user, code)
                permitted = allowed is None or bool(allowed)
            elif action == "create":
                parent_id = _positive_id(request.data.get("parent"))
                organization_id = parent_id
                permitted = _organization_allowed(user, code, parent_id)
            else:
                organization_id = _organization_id(object_pk)
                if organization_id is None:
                    raise NotFound()
                permitted = _organization_allowed(user, code, organization_id)
        elif code.startswith("sites."):
            if site_pk is not None:
                site_id = _positive_id(site_pk)
                organization_id = effective_scope_for_site(site_id) if site_id else None
                if organization_id is None:
                    raise NotFound()
                permitted = _site_allowed(user, code, organization_id, site_id)
            elif action == "list":
                allowed = authorized_site_ids(user, code)
                permitted = allowed is None or bool(allowed)
            elif action == "create":
                organization_id = _positive_id(request.data.get("organization_unit"))
                permitted = _organization_allowed(user, code, organization_id)
            elif action == "retrieve" or object_pk is not None:
                site_id = _positive_id(object_pk)
                organization_id = effective_scope_for_site(site_id) if site_id else None
                if organization_id is None:
                    raise NotFound()
                permitted = _site_allowed(user, code, organization_id, site_id)
            else:
                # Global module/template registries are platform scope.
                permitted = permission_granted(user, code, request=request)
        elif code in {"platform.users.view", "audit.logs.view"}:
            # Collection endpoints apply explicit row/queryset scope filtering.
            permitted = bool(live_assignments(user, code).exists()) or permission_granted(
                user, code, request=request,
            )
        elif code == "platform.users.assign_roles":
            organization_id, site_id = _assignment_scope(request, action, object_pk)
            permitted = permission_granted(
                user, code, organization_id=organization_id, site_id=site_id, request=request,
            )
        else:
            permitted = permission_granted(user, code, request=request)

        record_decision(
            user=user, action="API_PERMISSION_CHECK",
            outcome="ALLOW" if permitted else "DENY", permission_code=code,
            organization_id=organization_id, site_id=site_id, request=request,
        )
        return permitted

    def has_object_permission(self, request, view, obj):
        code = getattr(view, "required_permission", None)
        if not code:
            return False
        from .catalog import capability_for
        if capability_for(code) is None:
            return False
        user = request.user

        if code.startswith("platform.organizations."):
            permitted = _organization_allowed(user, code, getattr(obj, "pk", None))
        elif code.startswith("sites."):
            site_id = getattr(obj, "site_id", None) or getattr(obj, "pk", None)
            organization_id = getattr(obj, "organization_unit_id", None)
            if hasattr(obj, "site"):
                site_id = obj.site_id
                organization_id = obj.site.organization_unit_id
            if site_id and organization_id is None:
                organization_id = effective_scope_for_site(site_id)
            permitted = _site_allowed(user, code, organization_id, site_id)
        elif code == "platform.users.assign_roles":
            from .models import UserRoleAssignment
            assignment = UserRoleAssignment.objects.filter(pk=getattr(obj, "pk", None)).first()
            permitted = bool(assignment and permission_granted(
                user, code, organization_id=assignment.organization_id,
                site_id=assignment.site_id, request=request,
            ))
        else:
            permitted = permission_granted(user, code, request=request)

        record_decision(
            user=user, action="API_OBJECT_PERMISSION_CHECK",
            outcome="ALLOW" if permitted else "DENY", permission_code=code,
            resource_type=obj.__class__.__name__.lower(), resource_id=getattr(obj, "pk", ""),
            request=request,
        )
        return permitted


def _positive_id(value):
    try:
        identifier = int(value)
        return identifier if identifier > 0 else None
    except (TypeError, ValueError):
        return None


def _organization_id(value):
    organization_id = _positive_id(value)
    if organization_id is None:
        return None
    from apps.organizations.models import OrganizationUnit
    return OrganizationUnit.objects.filter(pk=organization_id).values_list("pk", flat=True).first()


def _organization_allowed(user, code, organization_id):
    if organization_id is None:
        return permission_granted(user, code, request=None)
    allowed = authorized_organization_ids(user, code)
    return allowed is None or organization_id in allowed


def _site_allowed(user, code, organization_id, site_id):
    if organization_id is None or site_id is None:
        return False
    allowed_sites = authorized_site_ids(user, code)
    if allowed_sites is None or site_id in allowed_sites:
        return True
    allowed_organizations = authorized_organization_ids(user, code)
    return allowed_organizations is None or organization_id in (allowed_organizations or ())


def _assignment_scope(request, action, object_pk):
    """Resolve assignment targets using stored Site ownership."""
    from .models import UserRoleAssignment
    from apps.sites.models import Site

    if action == "create":
        payload = request.data if isinstance(request.data, dict) else {}
        scope = payload.get("scope")
        if scope == UserRoleAssignment.Scope.PLATFORM:
            return None, None
        if scope == UserRoleAssignment.Scope.SITE:
            site_id = _positive_id(payload.get("site"))
            site = Site.objects.filter(pk=site_id).only("pk", "organization_unit_id").first()
            return (site.organization_unit_id, site.pk) if site else (None, None)
        return _positive_id(payload.get("organization")), None
    if action in {"revoke", "scope"}:
        assignment = UserRoleAssignment.objects.filter(pk=_positive_id(object_pk)).first()
        if assignment:
            return assignment.organization_id, assignment.site_id
    return None, None


class ManagementPermission(HasApplicationPermission):
    """Resolve an explicit capability for every management action; unknown denies."""
    def has_permission(self, request, view):
        action = getattr(view, "action", None)
        mapping = getattr(view, "permission_by_action", None)
        if mapping is None:
            return False
        required = mapping.get(action)
        if isinstance(required, dict):
            required = required.get(request.method)
        if not required and action is None:
            required = getattr(view, "permission_by_method", {}).get(request.method)
        if not required:
            return False
        view.required_permission = required
        return super().has_permission(request, view)


class IsAuthenticatedRBAC(ManagementPermission):
    """Alias for management views using bearer authentication and registered RBAC."""


class PageAccessPermission(BasePermission):
    """Published page reads stay public; writes need explicit scoped grants."""
    message = "You do not have permission to perform this action."
    action_permissions = {
        "create": "content.pages.create",
        "update": "content.pages.update",
        "partial_update": "content.pages.update",
        "destroy": "content.pages.delete",
    }

    def has_permission(self, request, view):
        action = getattr(view, "action", None)
        if action in {"list", "retrieve", "home"} and request.method in {"GET", "HEAD", "OPTIONS"}:
            return True
        if not request.user or not request.user.is_authenticated:
            raise NotAuthenticated()
        code = self.action_permissions.get(action)
        if code is None:
            return False
        page = None
        if action in {"update", "partial_update", "destroy"}:
            page = view.get_object()
            if page.site_id:
                permitted = _site_allowed(request.user, code, page.site.organization_unit_id, page.site_id)
            else:
                permitted = permission_granted(request.user, code, request=request)
        else:
            site_id = _positive_id(request.data.get("site")) if isinstance(request.data, dict) else None
            if site_id:
                organization_id = effective_scope_for_site(site_id)
                permitted = _site_allowed(request.user, code, organization_id, site_id)
            elif action == "create" and isinstance(request.data, dict) and "site" in request.data:
                # An explicitly supplied but malformed/unknown Site must never
                # silently fall back to an unscoped legacy page grant.
                permitted = False
            else:
                permitted = permission_granted(request.user, code, request=request)

        if permitted and action in {"create", "update", "partial_update"} and isinstance(request.data, dict) and "is_published" in request.data:
            desired_published = bool(request.data["is_published"])
            needs_publish_permission = desired_published if action == "create" else (
                page is not None and desired_published != page.is_published
            )
            if needs_publish_permission:
                if page and page.site_id:
                    permitted = _site_allowed(request.user, "content.pages.publish", page.site.organization_unit_id, page.site_id)
                elif action == "create" and request.data.get("site"):
                    site_id = _positive_id(request.data.get("site"))
                    organization_id = effective_scope_for_site(site_id) if site_id else None
                    permitted = _site_allowed(request.user, "content.pages.publish", organization_id, site_id)
                else:
                    permitted = permission_granted(request.user, "content.pages.publish", request=request)

        record_decision(
            user=request.user, action="PAGE_API_PERMISSION_CHECK",
            outcome="ALLOW" if permitted else "DENY", permission_code=code,
            resource_type="page", resource_id=page.pk if page else "", request=request,
        )
        return permitted
