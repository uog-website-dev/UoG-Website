"""
Health endpoints.

* ``/health/live``  — liveness: process is up; touches no dependencies.
* ``/health/ready`` — readiness: verifies critical dependencies
                      (PostgreSQL, Redis cache, MinIO object storage).
* ``/health/``      — legacy alias of the liveness endpoint.

See docs/development/health.md for the full reference.
"""
import logging
import time

from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse

logger = logging.getLogger(__name__)


def _check_database():
    """Verify a round-trip to the shared PostgreSQL database."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
        cursor.fetchone()


def _check_cache():
    """Verify a set/get round-trip against the Redis cache."""
    cache.set("health:ready", "ok", timeout=10)
    if cache.get("health:ready") != "ok":
        raise RuntimeError("cache round-trip mismatch")


def _check_object_storage():
    """Verify MinIO is reachable and the default bucket exists."""
    import boto3
    from botocore.config import Config

    client = boto3.client(
        "s3",
        endpoint_url=settings.AWS_S3_ENDPOINT_URL,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_S3_REGION_NAME,
        use_ssl=settings.AWS_S3_USE_SSL,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )
    client.head_bucket(Bucket=settings.AWS_STORAGE_BUCKET_NAME)


def liveness(request):
    """Liveness probe: the process is running and can serve requests."""
    return JsonResponse({"status": "ok"})


def readiness(request):
    """
    Readiness probe: 200 when every critical dependency is reachable,
    503 otherwise. Failure detail is limited to the exception class so no
    credentials or infrastructure internals leak.
    """
    checks = {}
    ready = True
    dependencies = (
        ("database", _check_database),
        ("cache", _check_cache),
        ("object_storage", _check_object_storage),
    )
    for name, check in dependencies:
        started = time.monotonic()
        try:
            check()
            checks[name] = {
                "status": "ok",
                "latency_ms": round((time.monotonic() - started) * 1000, 1),
            }
        except Exception as exc:  # noqa: BLE001 - report any dependency failure
            ready = False
            checks[name] = {"status": "error", "detail": exc.__class__.__name__}
            logger.warning("Readiness check %r failed: %s", name, exc)
    return JsonResponse(
        {"status": "ok" if ready else "unavailable", "checks": checks},
        status=200 if ready else 503,
    )
