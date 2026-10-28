"""Isolate this suite from Redis, MinIO, and the Celery broker.

``tests/conftest.py`` is loaded only for tests collected under ``tests/``.
This suite exercises resolution and the site-scoped cache keys directly
(``cache.set`` / ``caches["default"].make_key``), so without the same
overrides the default cache backend (Redis) is dialed at ``redis-cache`:
6379`` — a hostname that exists only in Docker Compose, not on a CI agent
or a laptop running pytest against a local database. The same overrides
are applied here so the sites suite never reaches those services.
"""
import pytest


@pytest.fixture(autouse=True)
def _isolate_external_services(settings):
    # LocMem replaces Redis only for the *connection*. Key semantics stay
    # production-identical: same prefix and KEY_FUNCTION
    # (apps.core.cache.make_cache_key) so tests that assert site-scoped keys
    # (``site:<pk>:…``) verify the real production behaviour.
    settings.CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "KEY_PREFIX": settings.CACHE_KEY_PREFIX,
            "KEY_FUNCTION": "apps.core.cache.make_cache_key",
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
