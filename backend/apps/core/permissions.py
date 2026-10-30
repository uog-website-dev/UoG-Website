"""Access policy shared by all API documentation views."""
from django.conf import settings
from rest_framework.exceptions import NotFound
from rest_framework.permissions import BasePermission

from apps.authorization.access import is_platform_administrator


class DocumentationPermission(BasePermission):
    def has_permission(self, request, view):
        if not settings.API_DOCS_ENABLED:
            raise NotFound()
        if settings.DEBUG:
            return True
        # Documentation is a protected API surface too: Django staff flags and
        # Keycloak role claims do not confer application authorization.
        return bool(
            request.user and request.user.is_active
            and (request.user.is_staff or is_platform_administrator(request.user))
        )
