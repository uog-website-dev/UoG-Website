"""Fixtures and service isolation for the cms suite.

The suite never reaches Redis, MinIO or the Celery broker (the same
overrides the organizations and sites suites apply), and it shares one
two-Site fixture so every test exercises real multi-tenant rows.
"""
from types import SimpleNamespace

import pytest

from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.sites.models import Site

from tests.oidc_helpers import (
    AUDIENCE,
    ISSUER,
    JWKS_URL,
    generate_signing_key,
    jwks_cache,
    make_token,
)


@pytest.fixture(scope="session")
def cms_signing_key():
    return generate_signing_key()


@pytest.fixture
def oidc(settings, monkeypatch, cms_signing_key):
    settings.OIDC_ISSUER = ISSUER
    settings.OIDC_JWKS_URL = JWKS_URL
    settings.OIDC_AUDIENCE = [AUDIENCE]
    settings.OIDC_ALLOWED_CLIENTS = ["public-web", "admin-web", "backend-api"]
    settings.OIDC_STAFF_ROLES = ["platform-admin"]
    cache = jwks_cache(cms_signing_key)
    monkeypatch.setattr(
        "apps.accounts.authentication.get_jwks_cache", lambda: cache,
    )

    def token(**overrides):
        return make_token(cms_signing_key, **overrides)

    def header(**overrides):
        return {"HTTP_AUTHORIZATION": f"Bearer {token(**overrides)}"}

    return SimpleNamespace(
        key=cms_signing_key, cache=cache, token=token, header=header,
    )


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


@pytest.fixture
def sites():
    """Two Sites owned by different Organizations — the multi-site baseline."""
    university, _ = OrganizationType.objects.get_or_create(code="UNIVERSITY", defaults={"name": "University"})
    college, _ = OrganizationType.objects.get_or_create(code="COLLEGE", defaults={"name": "College"})
    root = OrganizationUnit.objects.create(code="UOG", name="University of Gondar", organization_type=university)
    informatics = OrganizationUnit.objects.create(code="CI", name="College of Informatics", organization_type=college, parent=root)
    medicine = OrganizationUnit.objects.create(code="CM", name="College of Medicine", organization_type=college, parent=root)
    first = Site.objects.create(organization_unit=informatics, code="INFORMATICS", name="Informatics")
    second = Site.objects.create(organization_unit=medicine, code="MEDICINE", name="Medicine")
    return first, second


@pytest.fixture
def owner(sites):
    """The owning Organization of the first Site, for module tests."""
    return sites[0].organization_unit


@pytest.fixture
def cms_platform_admin(client, oidc):
    """An authenticated identity plus the explicit platform DB assignment."""
    from django.contrib.auth import get_user_model
    from django.core.management import call_command
    from apps.authorization.models import Role, UserRoleAssignment

    client.defaults.update(oidc.header())
    assert client.get("/api/me/").status_code == 200
    call_command("seed_rbac", verbosity=0)
    user = get_user_model().objects.get(username="devuser")
    UserRoleAssignment.objects.create(
        user=user, role=Role.objects.get(code="platform-administrator"), scope="PLATFORM",
    )
    return client
