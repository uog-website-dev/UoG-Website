"""The registry records capabilities. Only a shipped, enabled module can be turned on for a Site."""
from pathlib import Path

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction

from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.sites.models import Module, Site, SiteModule
from apps.sites.module_schema import empty_module_schema
from apps.sites.selectors.modules import capability_is_shipped, enabled_modules_for_site, module_is_usable, usable_modules
from apps.sites.services.modules import enable_module_for_site
from apps.sites.services.templates import provision_site

pytestmark = pytest.mark.django_db

INITIAL_CODES = {
    "CMS", "MEDIA", "STAFF_DIRECTORY", "ACADEMICS", "NEWS_ANNOUNCEMENTS",
    "EVENTS", "JOB_NOTICE_BOARD", "SEARCH", "ANALYTICS",
}


@pytest.fixture
def owner():
    college, _ = OrganizationType.objects.get_or_create(code="COLLEGE", defaults={"name": "College"})
    university, _ = OrganizationType.objects.get_or_create(code="UNIVERSITY", defaults={"name": "University"})
    root = OrganizationUnit.objects.create(code="UOG", name="University of Gondar", organization_type=university)
    return OrganizationUnit.objects.create(code="CI", name="College of Informatics", organization_type=college, parent=root)


def test_seeded_capabilities_are_not_advertised_as_usable(owner):
    assert INITIAL_CODES <= set(Module.objects.values_list("code", flat=True))
    cms = Module.objects.get(code="CMS")
    assert cms.name == "Content management" and cms.description
    assert cms.status == "PLANNED" and cms.is_enabled is False
    assert cms.configuration_schema == empty_module_schema()
    assert not capability_is_shipped("CMS")
    assert not usable_modules().exists()
    assert not any(field.name == "module_code" for field in Site._meta.local_fields)
    source = Path(usable_modules.__code__.co_filename).read_text(encoding="utf-8")
    assert not any(code in source for code in INITIAL_CODES)
    site = provision_site(organization_unit=owner, code="INFORMATICS", name="Informatics")
    with pytest.raises(ValidationError):
        enable_module_for_site(site.pk, cms.pk)
    assert not SiteModule.objects.exists()


def test_planned_and_unshipped_modules_cannot_be_enabled(owner):
    site = Site.objects.create(organization_unit=owner, code="PORTAL", name="Portal")
    cms = Module.objects.get(code="CMS")
    cms.is_enabled = True
    with pytest.raises(ValidationError):
        cms.save()
    cms.status = "IMPLEMENTED"
    cms.is_enabled = True
    with pytest.raises(ValidationError):
        cms.save()
    with pytest.raises(IntegrityError), transaction.atomic():
        Module.objects.filter(pk=cms.pk).update(status="IMPLEMENTED", is_enabled=True)
    cms.refresh_from_db()
    assert cms.status == "PLANNED" and cms.is_enabled is False
    with pytest.raises(ValidationError):
        enable_module_for_site(site.pk, cms.pk)
    with pytest.raises(IntegrityError), transaction.atomic():
        SiteModule.objects.bulk_create([SiteModule(site=site, module=cms)])
    retired = Module.objects.create(code="OLD", name="Old", description="Retired before it shipped.")
    retired.status = "DEPRECATED"
    retired.save()
    with pytest.raises(ValidationError):
        enable_module_for_site(site.pk, retired.pk)
    retired.status = "PLANNED"
    with pytest.raises(ValidationError):
        retired.save()


def test_only_a_shipped_enabled_module_can_be_newly_enabled(owner):
    with connection.cursor() as cursor:
        cursor.execute("INSERT INTO sites_module_implementation (code) VALUES ('FIXTURE')")
    module = Module.objects.create(
        code="FIXTURE", name="Fixture", description="A capability this deployment has shipped.",
        status="IMPLEMENTED", is_enabled=True,
    )
    schema = {"schema_version": 1, "properties": [{"code": "PAGE_SIZE", "label": "Page size", "type": "integer", "required": False}]}
    documented = Module.objects.create(code="DOCUMENTED", name="Documented", description="Schema without an implementation.", configuration_schema=schema)
    documented.refresh_from_db()
    assert documented.configuration_schema["properties"][0]["type"] == "integer"
    assert not module_is_usable(documented)
    first_site = Site.objects.create(organization_unit=owner, code="FIRST", name="First")
    second_site = Site.objects.create(organization_unit=owner, code="SECOND", name="Second")
    enablement = enable_module_for_site(first_site.pk, module.pk)
    assert list(enabled_modules_for_site(first_site.pk)) == [module]
    assert list(usable_modules()) == [module]
    module.is_enabled = False
    module.save(update_fields=["is_enabled"])
    assert SiteModule.objects.filter(pk=enablement.pk).exists()
    assert not enabled_modules_for_site(first_site.pk).exists()
    assert not usable_modules().exists()
    with pytest.raises(ValidationError):
        enable_module_for_site(second_site.pk, module.pk)
    with pytest.raises(IntegrityError), transaction.atomic():
        SiteModule.objects.bulk_create([SiteModule(site=second_site, module=module)])
    with pytest.raises(ValidationError):
        Module.objects.create(code="FIXTURE", name="Duplicate", description="Same code.")
    with pytest.raises(ValidationError):
        Module.objects.create(code="SECRET", name="Secret", description="No secrets.", configuration_schema={"password": "hidden"})
    with pytest.raises(IntegrityError), transaction.atomic():
        Module.objects.filter(pk=documented.pk).update(configuration_schema={"schema_version": 1, "custom": True})
