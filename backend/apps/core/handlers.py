"""
Central Celery signal handlers.

Every task failure and retry across the platform is logged here so that
background-processing problems are visible in container logs without any
per-task boilerplate.
"""
import logging

from celery.signals import task_failure, task_retry

logger = logging.getLogger("celery.task")


def handle_task_failure(task_id, exception, args, kwargs, sender=None, **_kwargs):
    task_name = getattr(sender, "name", repr(sender))
    logger.error(
        "Celery task %s[%s] failed: %r args=%r kwargs=%r",
        task_name,
        task_id,
        exception,
        args,
        kwargs,
        exc_info=True,
    )


def handle_task_retry(request=None, reason=None, sender=None, **_kwargs):
    task = getattr(request, "task", sender)
    task_name = getattr(task, "name", repr(task))
    retries = getattr(request, "retries", "?")
    task_id = getattr(request, "id", "?")
    logger.warning(
        "Celery task %s[%s] retry %s scheduled: %s",
        task_name,
        task_id,
        retries,
        reason or "unspecified reason",
    )


task_failure.connect(handle_task_failure, weak=False)
task_retry.connect(handle_task_retry, weak=False)
