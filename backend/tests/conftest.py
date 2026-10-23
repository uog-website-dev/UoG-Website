"""Shared pytest fixtures for the backend test suite."""
from types import SimpleNamespace

import pytest

from .oidc_helpers import (
    AUDIENCE,
    ISSUER,
    JWKS_URL,
    generate_signing_key,
    jwks_cache,
    make_token,
)


@pytest.fixture(autouse=True)
def _test_environment(settings):
    """Isolate tests from external services.

    * cache -> local memory (no Redis)
    * storage -> local filesystem (no MinIO)
    * Celery -> eager execution (no broker)
    """
    settings.CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        }
    }
    settings.STORAGES = {
        "default": {
            "BACKEND": "django.core.storage.filesystem.FileSystemStorage",
            "OPTIONS": {"location": str(settings.BASE_DIR / "test_media")},
        },
        "staticfiles": {
            "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
        },
    }
    settings.CELERY_TASK_ALWAYS_EAGER = True
    settings.CELERY_TASK_EAGER_PROPAGATES = False


@pytest.fixture(scope="session")
def signing_key():
    """The RSA key the test identity provider signs its tokens with."""
    return generate_signing_key()


@pytest.fixture
def oidc(settings, monkeypatch, signing_key):
    """A signed access token plus the JWKS cache that trusts its key.

    The fixture configures the API for a test identity provider and swaps
    the cached signing keys, so no test ever talks to Keycloak.
    """
    settings.OIDC_ISSUER = ISSUER
    settings.OIDC_JWKS_URL = JWKS_URL
    settings.OIDC_AUDIENCE = [AUDIENCE]
    settings.OIDC_ALLOWED_CLIENTS = ["public-web", "admin-web", "backend-api"]
    settings.OIDC_STAFF_ROLES = ["platform-admin"]

    cache = jwks_cache(signing_key)
    monkeypatch.setattr("apps.accounts.authentication.get_jwks_cache", lambda: cache)

    def token(**overrides) -> str:
        return make_token(signing_key, **overrides)

    def header(**overrides) -> dict:
        return {"HTTP_AUTHORIZATION": f"Bearer {token(**overrides)}"}

    return SimpleNamespace(
        key=signing_key, cache=cache, token=token, header=header
    )
