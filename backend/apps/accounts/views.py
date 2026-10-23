"""
Endpoints that expose the identity behind an access token.
"""
from django.contrib.auth import get_user_model
from drf_spectacular.utils import OpenApiExample, extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .permissions import HasRealmRole
from .authentication import KeycloakBearerAuthentication
from .serializers import AdminOverviewSerializer, IdentitySerializer


class MeView(APIView):
    """The identity behind the presented access token.

    Answers 401 without a valid Keycloak access token — the endpoint is
    the reference for "is my token accepted by the platform API?".
    """

    permission_classes = [IsAuthenticated]
    authentication_classes = [KeycloakBearerAuthentication]

    @extend_schema(
        tags=["Identity"], responses=IdentitySerializer,
        description="Current identity from a validated Keycloak access token. A bearer token is required; a browser session alone does not supply token claims.",
        examples=[OpenApiExample("Development identity", response_only=True, value={
            "username": "devuser", "email": "devuser@uog.et", "name": "Development User",
            "roles": ["platform-admin"], "is_staff": True, "client_id": "backend-api",
            "scopes": ["openid", "profile", "email"], "expires_at": 1800000000,
        })],
    )
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
    authentication_classes = [KeycloakBearerAuthentication]
    required_roles = {"platform-admin"}

    @extend_schema(
        tags=["Identity"], responses=AdminOverviewSerializer,
        description="Platform totals. Requires a validated bearer token containing the platform-admin role; a staff flag alone does not grant this operation.",
        examples=[OpenApiExample("Platform overview", response_only=True, value={
            "pages": 2, "published_pages": 1, "users": 3, "requested_by": "devuser",
        })],
    )
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
