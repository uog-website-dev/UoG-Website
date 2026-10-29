"""Fixtures and service isolation for the cms suite.

The suite never reaches Redis, MinIO or the Celery broker (the same
overrides the organizations and sites suites apply), and it shares one
two-Site fixture so every test exercises real multi-tenant rows.
"""
import pytest

from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.sites.models import Site


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
