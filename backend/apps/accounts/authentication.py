"""
Django REST Framework authentication against Keycloak access tokens.

The API is an OIDC *resource server*: it does not run the OAuth dance, it
validates the access token the frontends obtained from Keycloak and turns
its claims into a local account.
"""
from __future__ import annotations

from rest_framework import exceptions
from rest_framework.authentication import BaseAuthentication, get_authorization_header

from .config import get_jwks_cache, get_oidc_config
from .oidc import IdentityProviderUnavailable, TokenValidationError, validate_access_token
from .provisioning import AccountLinkError, provision_user


class KeycloakBearerAuthentication(BaseAuthentication):
    """Accepts a Keycloak access token as a bearer credential.

    The token is validated against the realm's JSON Web Key Set — signature,
    issuer, audience, expiry and the client the token was issued to. The
    claims are then provisioned into a local Django account.
    """

    keyword = "Bearer"

    def authenticate(self, request):
        header = get_authorization_header(request).split()
        if not header:
            return None
        if header[0].lower() != self.keyword.lower().encode():
            # Another authentication scheme — let the next authenticator try.
            return None
        if len(header) == 1:
            raise exceptions.AuthenticationFailed(
                "Invalid Authorization header. No credentials provided."
            )
        if len(header) > 2:
            raise exceptions.AuthenticationFailed(
                "Invalid Authorization header. Credentials string should not contain spaces."
            )
        try:
            token = header[1].decode("utf-8")
        except UnicodeError:
            raise exceptions.AuthenticationFailed(
                "Invalid Authorization header. Token contains invalid characters."
            )

        try:
            claims = validate_access_token(token, get_oidc_config(), get_jwks_cache())
        except TokenValidationError as exc:
            raise exceptions.AuthenticationFailed(str(exc))
        except IdentityProviderUnavailable as exc:
            raise exceptions.AuthenticationFailed(
                "The identity provider is temporarily unavailable."
            ) from exc

        try:
            user = provision_user(claims)
        except AccountLinkError as exc:
            raise exceptions.AuthenticationFailed(str(exc))

        return (user, claims)

    def authenticate_header(self, request):
        """Advertise the scheme so that unauthenticated calls answer 401."""
        return 'Bearer realm="uog"'
