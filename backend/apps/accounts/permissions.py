"""
Role-based permissions for API endpoints.

The roles come from the validated access token (Keycloak realm roles and
client roles), so a permission check never depends on client-supplied data.
"""
from rest_framework.permissions import BasePermission


class HasRealmRole(BasePermission):
    """Allows access to principals holding one of the roles the view requires.

    The view declares the roles it accepts through ``required_roles``::

        class AdminOverviewView(APIView):
            permission_classes = [IsAuthenticated, HasRealmRole]
            required_roles = {"platform-admin"}
    """

    def has_permission(self, request, view) -> bool:
        required = set(getattr(view, "required_roles", ()) or ())
        if not required:
            return False
        claims = getattr(request, "auth", None)
        roles = set(getattr(claims, "roles", ()) or ())
        return bool(required & roles)
