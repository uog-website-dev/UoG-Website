"""
Sample Celery tasks proving asynchronous and scheduled execution.

* ``core.ping``                 — ad-hoc task submitted by developers/smoke tests
* ``core.scheduled_heartbeat``  — executed by Celery Beat every minute

Both tasks auto-retry transient failures with exponential backoff; failures
and retries are logged centrally (see apps.core.handlers).
"""
import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    name="core.ping",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=60,
    max_retries=3,
)
def ping(self, message: str = "pong"):
    """Echo a message back — the platform's 'hello world' background task."""
    logger.info("core.ping[%s] received %r", self.request.id, message)
    result = {
        "message": message,
        "task_id": self.request.id,
        "received_at": timezone.now().isoformat(),
    }
    logger.info("core.ping[%s] completed", self.request.id)
    return result


@shared_task(
    bind=True,
    name="core.scheduled_heartbeat",
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=3,
)
def scheduled_heartbeat(self):
    """Periodic heartbeat driven by Celery Beat (every 60 seconds)."""
    now = timezone.now()
    logger.info("core.scheduled_heartbeat: platform heartbeat at %s", now.isoformat())
    return {"heartbeat_at": now.isoformat()}
