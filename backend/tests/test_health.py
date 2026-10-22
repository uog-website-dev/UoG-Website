"""Health endpoint tests."""
from unittest.mock import patch

import pytest


@pytest.mark.django_db
def test_liveness_responds(client):
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.django_db
def test_legacy_health_alias(client):
    response = client.get("/health/")
    assert response.status_code == 200


@pytest.mark.django_db
def test_readiness_all_dependencies_ok(client):
    with patch("apps.core.views._check_object_storage"):
        response = client.get("/health/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["checks"]["database"]["status"] == "ok"
    assert body["checks"]["cache"]["status"] == "ok"
    assert body["checks"]["object_storage"]["status"] == "ok"


@pytest.mark.django_db
def test_readiness_reports_failing_dependency(client):
    with patch(
        "apps.core.views._check_object_storage",
        side_effect=RuntimeError("storage down"),
    ):
        response = client.get("/health/ready")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "unavailable"
    assert body["checks"]["object_storage"]["status"] == "error"
    # Detail is the exception class only — no internals leaked.
    assert body["checks"]["object_storage"]["detail"] == "RuntimeError"
