"""
UoG Digital Platform Django configuration package.

This package is intentionally importable before Django is configured so that
tooling and tests that import ``config`` do not fail while settings are still
being assembled. The real app registry is configured by the Django startup
path (``manage.py``, ``wsgi.py``, and the pytest-django plugin via
``DJANGO_SETTINGS_MODULE``).
"""

# Celery application instance. Imported lazily in ``celery.py`` so that
# ``config`` is importable even in environments without the ``celery`` package
# installed.
try:
    from .celery import app as celery_app  # noqa: F401
except Exception:  # pragma: no cover - environment dependent
    celery_app = None
