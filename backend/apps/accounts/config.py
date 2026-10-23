"""
Bridge between the Django settings and the OIDC validation module.

The settings are read lazily (and on every request) so that they can be
overridden in tests and changed without restarting the process.
"""
from __future__ import annotations

import threading

from django.conf import settings

from .oidc import JWKSCache, OIDCConfig

_jwks_caches: dict[str, JWKSCache] = {}
_jwks_lock = threading.Lock()


def get_oidc_config() -> OIDCConfig:
    """The OIDC configuration of the running platform."""
    return OIDCConfig(
        issuer=settings.OIDC_ISSUER,
        jwks_url=settings.OIDC_JWKS_URL,
        audiences=tuple(settings.OIDC_AUDIENCE),
        allowed_clients=tuple(settings.OIDC_ALLOWED_CLIENTS),
        algorithms=tuple(settings.OIDC_ALLOWED_ALGORITHMS),
        leeway_seconds=settings.OIDC_LEEWAY_SECONDS,
        jwks_cache_seconds=settings.OIDC_JWKS_CACHE_SECONDS,
        http_timeout_seconds=settings.OIDC_HTTP_TIMEOUT_SECONDS,
    )


def get_jwks_cache() -> JWKSCache:
    """The (cached) signing keys of the identity provider."""
    config = get_oidc_config()
    with _jwks_lock:
        cache = _jwks_caches.get(config.jwks_url)
        if cache is None:
            cache = JWKSCache(
                config.jwks_url,
                cache_seconds=config.jwks_cache_seconds,
                timeout_seconds=config.http_timeout_seconds,
            )
            _jwks_caches[config.jwks_url] = cache
        return cache


def reset_jwks_caches() -> None:
    """Forget every cached signing key (used by the test suite)."""
    with _jwks_lock:
        _jwks_caches.clear()
