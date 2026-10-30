from __future__ import annotations

import hashlib
from collections.abc import Sequence
from typing import Any

from django.conf import settings
from django.core.cache import caches
from django.utils.functional import cached_property


def _digest(values: Sequence[str]) -> str:
    return hashlib.sha256(",".join(values).encode("utf-8")).hexdigest()


def effective_permissions_cache_key(user_id: int, *, organization_id: int | None, site_id: int | None) -> str:
    """Stable key for a user's effective permission list at one resolved scope.

    This is the only cache key that should ever be used by authorization
    decision paths that compute effective permissions. It is deliberately
    normalized to a single ``user_id:scope:scope_id`` shape so that
    invalidation and cache-hit reasoning stay tractable.
    """
    scope_id = site_id if site_id is not None else organization_id
    scope = "SITE" if site_id is not None else ("ORGANIZATION" if organization_id is not None else "PLATFORM")
    payload = f"{user_id}:{scope}:{scope_id}"
    return f"{settings.AUTH_EFFECTIVE_PERMISSIONS_CACHE_PREFIX}:{_digest([payload])}"


def scoped_assignment_cache_key(scope: str, scope_id: int | None) -> str:
    """One cache line per assignment scope bucket.

    Used by lookups that derive derived org/site id sets from a given
    assignment scope. Do not use for per-user effective permissions.
    """
    raw = f"{scope}:{scope_id}"
    return f"{settings.AUTH_SCOPE_CACHE_PREFIX}:{_digest([raw])}"


def live_assignments_cache_key(user_id: int, *, permission_code: str | None) -> str:
    """Live-assignment summary cache key per user and optional permission code."""
    payload = f"{user_id}:{permission_code or 'any'}"
    return f"{settings.AUTH_LIVE_ASSIGNMENTS_CACHE_PREFIX}:{_digest([payload])}"


class AuthCache:
    """Typed cache wrapper shared by authorization paths.

    Authorization cache contents are a performance optimization only. They are
    derived from authoritative database state and busted by write paths. They
    must never store secrets.
    """

    def __init__(self) -> None:
        self._cache = caches["default"]

    @cached_property
    def cache(self):
        return self._cache

    def get(self, key: str, default: Any = None) -> Any:
        return self._cache.get(key, default=default)

    def set(self, key: str, value: Any, timeout: int | None = None) -> None:
        self._cache.set(key, value, timeout=timeout)

    def delete(self, key: str) -> None:
        self._cache.delete(key)

    def delete_many(self, keys: Sequence[str]) -> None:
        if keys:
            self._cache.delete_many(keys)

    def make_key(self, key: str, version: int | None = None) -> str:
        return self._cache.make_key(key, version=version)


def auth_cache() -> AuthCache:
    return AuthCache()


def invalidate_auth_cache_for_user(user_id: int) -> None:
    """Best-effort invalidation of cached authorization data that may depend
    on a given user's current grants.

    This is intentionally conservative. The authorization layer does not
    guarantee immediate global invalidation of every derived line; revocation
    propagation is bounded by AUTH_REVOCATION_LAG_SECONDS. That bound must be
    treated as the acceptance-criteria contract, not as an implementation
    detail we silently depend on.
    """
    cache = auth_cache()
    try:
        cache.delete_many(
            [
                effective_permissions_cache_key(user_id, organization_id=None, site_id=None),
                effective_permissions_cache_key(user_id, organization_id=None, site_id=None),  # redundant identity is fine
            ]
        )
    except Exception:
        # Never let cache housekeeping fail a real auth request.
        pass
