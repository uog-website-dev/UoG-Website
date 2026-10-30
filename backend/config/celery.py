"""
Celery application for the UoG Digital Platform.

The module is importable even when the ``celery`` package is not installed,
because the test runner and some test helpers configure Django from
settings alone and do not start any broker. The real app instance is created
only when ``celery`` is available at runtime.
"""
from __future__ import annotations

import os
from pathlib import Path

from decouple import config

BASE_DIR = Path(__file__).resolve().parent.parent

# Celery's CLI does not run manage.py, which normally selects Django settings.
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")


def _celery_app():
    """Create or retrieve the Celery application instance.

    Imported lazily so ``config`` can be imported without ``celery``
    installed (for example in environments that only run the Django test
    suite and never start a broker).
    """
    try:
        from celery import Celery
    except Exception as exc:  # pragma: no cover - environment dependent
        raise RuntimeError(
            "Celery is not available in this environment. "
            "Install the project dependencies or run only the Django test suite "
            "with CELERY_TASK_ALWAYS_EAGER configured and no broker."
        ) from exc

    app = Celery(
        "uog",
        broker_url=config("CELERY_BROKER_URL"),
        result_backend=config("CELERY_RESULT_BACKEND"),
        timezone=config("CELERY_TIMEZONE", default="UTC"),
    )
    app.config_from_object("django.conf:settings", namespace="CELERY")
    app.autodiscover_tasks()
    app.conf.beat_schedule = {
        "core-heartbeat-every-minute": {
            "task": "core.scheduled_heartbeat",
            "schedule": 60.0,
        },
    }
    return app


try:
    app = _celery_app()
except RuntimeError:
    app = None
