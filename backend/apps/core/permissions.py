"""Access policy shared by all API documentation views."""
from django.conf import settings
from rest_framework.exceptions import NotFound
from rest_framework.permissions import BasePermission


class DocumentationPermission(BasePermission):
    def has_permission(self, request, view):
        if not settings.API_DOCS_ENABLED:
            raise NotFound()
        if settings.DEBUG:
            return True
        return bool(request.user and request.user.is_active and request.user.is_staff)
