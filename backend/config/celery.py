"""
Celery configuration for the UoG Digital Platform backend.

The worker connects to the dedicated broker Redis (redis-broker); Celery Beat
runs as a separate service and drives the platform schedule below.
"""
import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("uog")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

# Reconciled P0 scheduling decision: Celery Beat (single instance) with the
# Redis broker — no external cron. Schedule entries live here so that later
# stories (organization/site management) extend one central place.
app.conf.beat_schedule = {
    "core-heartbeat-every-minute": {
        "task": "core.scheduled_heartbeat",
        "schedule": 60.0,
    },
}


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    """Diagnostic task: `celery -A config call config.celery.debug_task`."""
    print(f"debug_task: request={self.request!r}")  # noqa: T201
