"""Legacy identity-claim adapter retained for non-authorization compatibility.

Application management authorization must use registered database capabilities;
Keycloak realm roles establish identity context only and never grant access.
"""
from rest_framework.permissions import BasePermission

from apps.authorization.access import is_platform_administrator
from apps.authorization.services import record_decision
from rest_framework.exceptions import PermissionDenied


class HasRealmRole(BasePermission):
    """Allows access to principals holding one of the roles the view requires.

    The view declares the roles it accepts through ``required_roles``::

        class AdminOverviewView(APIView):
            permission_classes = [IsAuthenticated, HasRealmRole]
            required_roles = {"platform-admin"}
    """

    def has_permission(self, request, view) -> bool:
        permitted = is_platform_administrator(request.user)
        record_decision(
            user=request.user,
            action="LEGACY_REALM_ROLE_GATE",
            outcome="ALLOW" if permitted else "DENY",
            request=request,
        )
        return permitted
