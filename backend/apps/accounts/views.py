"""
Endpoints that expose the identity behind an access token.
"""
from django.contrib.auth import get_user_model
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .permissions import HasRealmRole


class MeView(APIView):
    """The identity behind the presented access token.

    Answers 401 without a valid Keycloak access token — the endpoint is
    the reference for "is my token accepted by the platform API?".
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        claims = request.auth
        return Response(
            {
                "username": request.user.get_username(),
                "email": request.user.email,
                "name": claims.full_name or request.user.get_full_name(),
                "roles": list(claims.roles),
                "is_staff": request.user.is_staff,
                "client_id": claims.client_id,
                "scopes": list(claims.scopes),
                "expires_at": claims.expires_at,
            }
        )


class AdminOverviewView(APIView):
    """Platform overview — restricted to the platform administrators."""

    permission_classes = [IsAuthenticated, HasRealmRole]
    required_roles = {"platform-admin"}

    def get(self, request):
        from apps.api.models import Page

        return Response(
            {
                "pages": Page.objects.count(),
                "published_pages": Page.objects.filter(is_published=True).count(),
                "users": get_user_model().objects.count(),
                "requested_by": request.user.get_username(),
            }
        )
