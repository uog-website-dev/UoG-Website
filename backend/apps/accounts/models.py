"""
Local accounts for platform users.

The Django user table stays the single source of truth for platform
permissions. Keycloak remains the identity provider: the stable subject
(``sub``) of a Keycloak account is linked to a local user through
:class:`OIDCIdentity`, so a renamed Keycloak user keeps its local account
and its platform permissions.
"""
from django.conf import settings
from django.db import models


class OIDCIdentity(models.Model):
    """A Keycloak account linked to a local Django user."""

    issuer = models.CharField(
        max_length=255,
        help_text="The issuer of the identity provider that issued the token.",
    )
    subject = models.CharField(
        max_length=255,
        help_text="The stable subject (sub) claim of the Keycloak account.",
    )
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="oidc_identity",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    last_synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "OIDC identity"
        verbose_name_plural = "OIDC identities"
        constraints = [
            models.UniqueConstraint(
                fields=["issuer", "subject"],
                name="unique_oidc_issuer_subject",
            )
        ]

    def __str__(self) -> str:
        return f"{self.user} ({self.issuer})"
