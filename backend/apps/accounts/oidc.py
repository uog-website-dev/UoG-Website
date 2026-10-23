"""
Keycloak OIDC access-token validation.

The platform authenticates against Keycloak (realm ``uog``). The Next.js
frontends sign the user in through Auth.js and receive a Keycloak *access
token*; the Django API accepts that token as a bearer credential and turns
its claims into a local account.

This module is deliberately free of Django imports so that the validation
logic can be unit tested on its own. It implements the resource-server half
of OIDC: the signature is verified against the realm's JSON Web Key Set, and
the registered claims (issuer, audience, expiry) are checked before the
claims are handed over to the account layer.

Only asymmetric algorithms are accepted — a token signed with a shared
secret would let anybody who knows the secret mint API credentials.
"""
from __future__ import annotations

import json
import threading
import time
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Sequence

import jwt
from jwt import PyJWK, PyJWKSet

__all__ = [
    "IdentityProviderUnavailable",
    "JWKSCache",
    "OIDCConfig",
    "OIDCError",
    "TokenClaims",
    "TokenValidationError",
    "validate_access_token",
]


class OIDCError(Exception):
    """Base class for every error raised by this module."""


class TokenValidationError(OIDCError):
    """The presented access token is not acceptable."""


class IdentityProviderUnavailable(OIDCError):
    """The identity provider (JWKS endpoint) could not be reached."""


@dataclass(frozen=True)
class OIDCConfig:
    """Everything the API needs to know about the identity provider.

    ``issuer`` is the *public* issuer Keycloak stamps into its tokens (the
    one the browser sees), while ``jwks_url`` may point at an internal
    address — the containers talk to Keycloak over the Docker network.
    """

    issuer: str
    jwks_url: str
    audiences: tuple[str, ...] = ("backend-api",)
    allowed_clients: tuple[str, ...] = ()
    algorithms: tuple[str, ...] = ("RS256",)
    leeway_seconds: int = 30
    jwks_cache_seconds: int = 300
    http_timeout_seconds: int = 10


@dataclass(frozen=True)
class TokenClaims:
    """The claims of a validated access token."""

    subject: str
    issuer: str
    client_id: str
    username: str
    email: str
    full_name: str
    given_name: str
    family_name: str
    realm_roles: tuple[str, ...]
    client_roles: tuple[str, ...]
    scopes: tuple[str, ...]
    session_id: str
    issued_at: int
    expires_at: int

    @property
    def roles(self) -> tuple[str, ...]:
        """Realm roles and client roles, without duplicates."""
        return tuple(dict.fromkeys(self.realm_roles + self.client_roles))


def _fetch_json(url: str, timeout: int) -> Mapping[str, Any]:
    """Fetch a JSON document (the realm's JWKS) over HTTP."""
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8"))


class JWKSCache:
    """Caches the realm's JSON Web Key Set and resolves signing keys by id.

    Keycloak rotates its signing keys; an unknown key id therefore triggers
    an immediate refresh instead of failing the request, and a key id that
    is still unknown afterwards is remembered for the rest of the cache
    window so that unknown ids cannot be used to hammer the identity
    provider.
    """

    def __init__(
        self,
        url: str,
        cache_seconds: int = 300,
        timeout_seconds: int = 10,
        fetcher: Callable[[str, int], Mapping[str, Any]] | None = None,
    ) -> None:
        self.url = url
        self.cache_seconds = cache_seconds
        self.timeout_seconds = timeout_seconds
        self._fetcher = fetcher or _fetch_json
        self._lock = threading.Lock()
        self._keys: dict[str, PyJWK] = {}
        self._unknown: set[str] = set()
        self._expires_at = 0.0

    def get_key(self, kid: str) -> PyJWK | None:
        """Return the signing key for ``kid``, or ``None`` when unknown."""
        with self._lock:
            if kid in self._unknown and time.monotonic() < self._expires_at:
                return None
            if time.monotonic() >= self._expires_at or kid not in self._keys:
                self._refresh()
            key = self._keys.get(kid)
            if key is None:
                self._unknown.add(kid)
            return key

    def invalidate(self) -> None:
        """Drop the cached keys (the next lookup refetches them)."""
        with self._lock:
            self._keys = {}
            self._unknown = set()
            self._expires_at = 0.0

    def _refresh(self) -> None:
        try:
            document = self._fetcher(self.url, self.timeout_seconds)
        except Exception as exc:  # noqa: BLE001 - any transport error is fatal here
            raise IdentityProviderUnavailable(
                f"Could not fetch the signing keys from {self.url}: {exc}"
            ) from exc
        try:
            key_set = PyJWKSet.from_dict(dict(document))
        except Exception as exc:  # noqa: BLE001 - malformed JWKS
            raise IdentityProviderUnavailable(
                f"The signing keys at {self.url} could not be parsed: {exc}"
            ) from exc
        keys: dict[str, PyJWK] = {}
        for key in key_set.keys:
            # Encryption keys are published next to the signing keys; they
            # must never be used to verify a token.
            if key.public_key_use not in (None, "sig"):
                continue
            if not key.key_id:
                continue
            keys[key.key_id] = key
        self._keys = keys
        self._unknown = set()
        self._expires_at = time.monotonic() + self.cache_seconds


def _verify_audience(claims: Mapping[str, Any], expected: Sequence[str]) -> None:
    """The token must have been issued for this API."""
    if not expected:
        return
    raw = claims.get("aud")
    if not raw:
        raise TokenValidationError("access token has no audience")
    audiences = [raw] if isinstance(raw, str) else list(raw)
    if not any(audience in audiences for audience in expected):
        raise TokenValidationError(
            "access token was not issued for this API "
            f"(audience {sorted(audiences)} does not include {sorted(expected)})"
        )


def _claims_from_payload(payload: Mapping[str, Any]) -> TokenClaims:
    client_id = str(payload.get("azp") or "")
    realm_access = payload.get("realm_access") or {}
    resource_access = payload.get("resource_access") or {}
    client_roles = (resource_access.get(client_id) or {}).get("roles") or []
    scope = payload.get("scope") or ""
    scopes = tuple(scope.split()) if isinstance(scope, str) else tuple(scope)
    return TokenClaims(
        subject=str(payload["sub"]),
        issuer=str(payload["iss"]),
        client_id=client_id,
        username=str(payload.get("preferred_username") or payload["sub"]),
        email=str(payload.get("email") or ""),
        full_name=str(payload.get("name") or ""),
        given_name=str(payload.get("given_name") or ""),
        family_name=str(payload.get("family_name") or ""),
        realm_roles=tuple(realm_access.get("roles") or ()),
        client_roles=tuple(client_roles),
        scopes=scopes,
        session_id=str(payload.get("sid") or ""),
        issued_at=int(payload.get("iat") or 0),
        expires_at=int(payload.get("exp") or 0),
    )


def validate_access_token(
    token: str,
    config: OIDCConfig,
    jwks: JWKSCache,
) -> TokenClaims:
    """Validate a Keycloak access token and return its claims.

    Raises :class:`TokenValidationError` when the token must be rejected and
    :class:`IdentityProviderUnavailable` when the signing keys cannot be
    fetched.
    """
    if not token or not token.strip():
        raise TokenValidationError("no access token was presented")

    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise TokenValidationError("access token is not a readable JWT") from exc

    algorithm = header.get("alg")
    if algorithm not in config.algorithms:
        raise TokenValidationError(
            f"access token uses the unsupported algorithm {algorithm!r}"
        )

    kid = header.get("kid")
    if not kid:
        raise TokenValidationError("access token does not name a signing key")
    key = jwks.get_key(kid)
    if key is None:
        raise TokenValidationError("access token was signed with an unknown key")

    try:
        payload = jwt.decode(
            token,
            key.key,
            algorithms=list(config.algorithms),
            issuer=config.issuer,
            leeway=config.leeway_seconds,
            options={"require": ["exp", "iat", "iss", "sub"], "verify_aud": False},
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenValidationError("access token has expired") from exc
    except jwt.InvalidIssuerError as exc:
        raise TokenValidationError(
            "access token was issued by another identity provider"
        ) from exc
    except jwt.MissingRequiredClaimError as exc:
        raise TokenValidationError(
            f"access token is missing the {exc.claim!r} claim"
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise TokenValidationError(f"access token is invalid: {exc}") from exc

    _verify_audience(payload, config.audiences)

    if config.allowed_clients:
        client_id = str(payload.get("azp") or "")
        if client_id not in config.allowed_clients:
            raise TokenValidationError(
                f"access token was issued to the unexpected client {client_id!r}"
            )

    return _claims_from_payload(payload)
