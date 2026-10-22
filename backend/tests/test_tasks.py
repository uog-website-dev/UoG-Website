"""Celery task and beat-schedule tests (eager execution, no broker)."""
import logging
from contextlib import contextmanager

import pytest
from celery.signals import task_failure, task_retry

from apps.core.tasks import ping, scheduled_heartbeat
from config.celery import app as celery_app


@contextmanager
def captured_celery_logs():
    """Let the Celery loggers reach the root logger, where pytest captures.

    The platform configures the ``celery`` logger with ``propagate=False``
    so that its records are not printed twice — which also keeps them out
    of pytest's log capture.
    """
    loggers = [logging.getLogger("celery"), logging.getLogger("celery.task")]
    previous = [logger.propagate for logger in loggers]
    for logger in loggers:
        logger.propagate = True
    try:
        yield
    finally:
        for logger, value in zip(loggers, previous):
            logger.propagate = value


def test_ping_task_executes():
    result = ping.apply(args=("hello",)).get()
    assert result["message"] == "hello"
    assert "task_id" in result
    assert "received_at" in result


def test_scheduled_heartbeat_task_executes():
    result = scheduled_heartbeat.apply().get()
    assert "heartbeat_at" in result


def test_beat_schedule_registers_heartbeat():
    schedule = celery_app.conf.beat_schedule
    tasks = [entry["task"] for entry in schedule.values()]
    assert "core.scheduled_heartbeat" in tasks


def test_task_failure_is_logged(caplog):
    with captured_celery_logs():
        with caplog.at_level(logging.ERROR, logger="celery.task"):
            task_failure.send(
                sender=ping,
                task_id="test-task-id",
                exception=RuntimeError("boom"),
                args=(),
                kwargs={},
                traceback=None,
                einfo=None,
            )
    assert any("failed" in record.message for record in caplog.records)


def test_task_retry_is_logged(caplog):
    class FakeRequest:
        id = "test-task-id"
        retries = 1
        task = ping

    with captured_celery_logs():
        with caplog.at_level(logging.WARNING, logger="celery.task"):
            task_retry.send(sender=ping, request=FakeRequest(), reason="network blip")
    assert any("retry" in record.message for record in caplog.records)
