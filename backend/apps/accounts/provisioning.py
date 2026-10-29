"""
Provisioning of local Django accounts from Keycloak claims.

The Keycloak account owns the identity (it authenticates the user, it holds
the roles); the Django account owns the platform permissions. Both are kept
in sync whenever a valid access token is presented.
"""
from __future__ import annotations

import re

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction

from .models import OIDCIdentity
from .oidc import TokenClaims

User = get_user_model()

_INVALID_USERNAME_CHARS = re.compile(r"[^\w.@+-]", re.UNICODE)


class AccountLinkError(Exception):
    """The Keycloak account cannot be linked to a local account."""


def _safe_username(username: str, subject: str) -> str:
    """A Django-usable username derived from the Keycloak username."""
    candidate = _INVALID_USERNAME_CHARS.sub("-", username)[:150]
    if not candidate:
        candidate = f"uog-{subject[:12]}"
    if User.objects.filter(username__iexact=candidate).exists():
        candidate = f"{candidate[:140]}-{subject[:8]}"
    return candidate


def _claim_local_user(claims: TokenClaims):
    """Return the local user for a Keycloak account that is not linked yet.

    A local account with the same name is only claimed when it clearly
    belongs to the same person (same e-mail address) — otherwise the
    identity provider and the platform would fight over the account.
    """
    existing = User.objects.filter(username__iexact=claims.username).first()
    if existing is not None:
        if OIDCIdentity.objects.filter(user=existing).exists():
            raise AccountLinkError(
                f"The account '{existing.get_username()}' is already linked to "
                "another identity."
            )
        if (
            existing.email
            and claims.email
            and existing.email.casefold() != claims.email.casefold()
        ):
            raise AccountLinkError(
                f"The account '{existing.get_username()}' already exists with a "
                "different e-mail address."
            )
        return existing

    username = _safe_username(claims.username, claims.subject)
    return User.objects.create(username=username, email=claims.email)


def _sync_profile(user, claims: TokenClaims) -> None:
    # Accounts created while tokens omitted preferred_username were stored
    # under the subject id. Correct that once a real username arrives.
    # A later rename keeps the same row; it does not replace a real username.
    if (
        user.username == claims.subject
        and claims.username
        and claims.username != claims.subject
        and not User.objects.filter(username__iexact=claims.username)
        .exclude(pk=user.pk)
        .exists()
    ):
        user.username = _INVALID_USERNAME_CHARS.sub("-", claims.username)[:150]
    user.first_name = claims.given_name or user.first_name
    user.last_name = claims.family_name or user.last_name
    if claims.email:
        user.email = claims.email
    user.is_active = True


def _sync_roles(user, claims: TokenClaims) -> None:
    """Keycloak roles describe identity; Django application grants are separate."""
    # Do not mirror realm roles into Django groups or is_staff. They are not
    # application authorization and must not unlock Django admin access.
    return None


@transaction.atomic
def provision_user(claims: TokenClaims):
    """Return the local Django user for the given (validated) claims.

    The identity is looked up by ``(issuer, subject)``, the stable Keycloak
    key: renaming an account in Keycloak does not create a second local
    user.
    """
    identity = (
        OIDCIdentity.objects.select_related("user")
        .filter(issuer=claims.issuer, subject=claims.subject)
        .first()
    )
    if identity is not None:
        user = identity.user
    else:
        user = _claim_local_user(claims)
        identity = OIDCIdentity.objects.create(
            issuer=claims.issuer,
            subject=claims.subject,
            user=user,
        )

    _sync_profile(user, claims)
    user.save()
    identity.save()
    return user
