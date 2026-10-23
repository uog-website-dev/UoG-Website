"""Isolate this suite from Redis, MinIO, and the Celery broker.

``tests/conftest.py`` is loaded only for tests collected under ``tests/``.
The same overrides are applied here so the organizations suite does not
reach those services.
"""
import pytest


@pytest.fixture(autouse=True)
def _isolate_external_services(settings):
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
