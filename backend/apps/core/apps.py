"""Platform core: health endpoints, cache helpers, and sample Celery tasks."""
from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"
    verbose_name = "Platform Core"

    def ready(self):  # pragma: no cover - signal wiring
        from . import handlers  # noqa: F401
