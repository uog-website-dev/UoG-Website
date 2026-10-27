"""Each Site enables shipped modules independently. Disabling keeps the row."""
import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext

from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.sites.middleware import SiteResolutionMiddleware
from apps.sites.models import Module, Site, SiteDomain, SiteModule
from apps.sites.selectors.modules import available_module_codes, module_available_on_request, module_is_available
from apps.sites.services.lifecycle import activate_site
from apps.sites.services.modules import disable_module_for_site, enable_module_for_site

pytestmark = pytest.mark.django_db


@pytest.fixture
def sites():
    college, _ = OrganizationType.objects.get_or_create(code="COLLEGE", defaults={"name": "College"})
    university, _ = OrganizationType.objects.get_or_create(code="UNIVERSITY", defaults={"name": "University"})
    root = OrganizationUnit.objects.create(code="UOG", name="University of Gondar", organization_type=university)
    informatics_unit = OrganizationUnit.objects.create(code="CI", name="College of Informatics", organization_type=college, parent=root)
    medicine_unit = OrganizationUnit.objects.create(code="CM", name="College of Medicine", organization_type=college, parent=root)
    informatics = Site.objects.create(organization_unit=informatics_unit, code="INFORMATICS", name="Informatics")
    medicine = Site.objects.create(organization_unit=medicine_unit, code="MEDICINE", name="Medicine")
    activate_site(informatics.pk)
    activate_site(medicine.pk)
    SiteDomain.objects.create(site=informatics, hostname="informatics.uog.edu.et", is_primary=True, status="ACTIVE")
    SiteDomain.objects.create(site=medicine, hostname="medicine.uog.edu.et", is_primary=True, status="ACTIVE")
    with connection.cursor() as cursor:
        cursor.execute("INSERT INTO sites_module_implementation (code) VALUES ('EVENTS'), ('STAFF_DIRECTORY')")
    events = Module.objects.get(code="EVENTS")
    events.status = "IMPLEMENTED"
    events.is_enabled = True
    events.configuration_schema = {"schema_version": 1, "properties": [
        {"code": "PAGE_SIZE", "label": "Page size", "type": "integer", "required": True},
    ]}
    events.save()
    staff = Module.objects.get(code="STAFF_DIRECTORY")
    staff.status = "IMPLEMENTED"
    staff.is_enabled = True
    staff.save()
    return informatics, medicine, events, staff


def test_sites_enable_different_modules_and_disabling_keeps_configuration(sites):
    informatics, medicine, events, staff = sites
    informatics_events = enable_module_for_site(informatics.pk, events.pk, configuration={"PAGE_SIZE": 20})
    enable_module_for_site(informatics.pk, staff.pk)
    enable_module_for_site(medicine.pk, staff.pk)
    with pytest.raises(ValidationError):
        enable_module_for_site(medicine.pk, events.pk, configuration={"PAGE_SIZE": "many"})
    with pytest.raises(IntegrityError), transaction.atomic():
        SiteModule.objects.bulk_create([SiteModule(site=medicine, module=staff, is_enabled=True, configuration={})])
    assert available_module_codes(informatics.pk) == {"EVENTS", "STAFF_DIRECTORY"}
    assert available_module_codes(medicine.pk) == {"STAFF_DIRECTORY"}
    assert module_is_available(informatics.pk, "EVENTS")
    assert not module_is_available(medicine.pk, "EVENTS")

    with CaptureQueriesContext(connection) as captured:
        assert available_module_codes(informatics.pk) == {"EVENTS", "STAFF_DIRECTORY"}
    assert len(captured) == 1

    disable_module_for_site(informatics.pk, events.pk)
    informatics_events.refresh_from_db()
    assert informatics_events.is_enabled is False
    assert informatics_events.configuration == {"PAGE_SIZE": 20}
    assert SiteModule.objects.filter(pk=informatics_events.pk).exists()
    assert available_module_codes(informatics.pk) == {"STAFF_DIRECTORY"}
    assert available_module_codes(medicine.pk) == {"STAFF_DIRECTORY"}
    with pytest.raises(ValidationError):
        informatics_events.delete()

    events.is_enabled = False
    events.save(update_fields=["is_enabled"])
    with pytest.raises(ValidationError):
        enable_module_for_site(informatics.pk, events.pk)
    informatics_events.refresh_from_db()
    assert informatics_events.configuration == {"PAGE_SIZE": 20}
    events.is_enabled = True
    events.save(update_fields=["is_enabled"])
    restored = enable_module_for_site(informatics.pk, events.pk)
    assert restored.pk == informatics_events.pk
    assert restored.configuration == {"PAGE_SIZE": 20}
    assert module_is_available(informatics.pk, "EVENTS")
    with pytest.raises(IntegrityError), transaction.atomic():
        SiteModule.objects.filter(pk=restored.pk).update(configuration={"PAGE_SIZE": "20"})
    restored.refresh_from_db()
    assert restored.configuration == {"PAGE_SIZE": 20}


def test_request_availability_follows_the_resolved_site(sites, rf):
    informatics, medicine, events, staff = sites
    enable_module_for_site(informatics.pk, events.pk, configuration={"PAGE_SIZE": 10})
    enable_module_for_site(medicine.pk, staff.pk)
    seen = {}

    from django.http import HttpResponse

    def view(request):
        seen["codes"] = set(request.enabled_module_codes)
        seen["events"] = module_available_on_request(request, "EVENTS")
        seen["staff"] = module_available_on_request(request, "STAFF_DIRECTORY")
        return HttpResponse("ok")

    SiteResolutionMiddleware(view)(rf.get("/", HTTP_HOST="informatics.uog.edu.et"))
    assert seen == {"codes": {"EVENTS"}, "events": True, "staff": False}
    SiteResolutionMiddleware(view)(rf.get("/", HTTP_HOST="medicine.uog.edu.et"))
    assert seen == {"codes": {"STAFF_DIRECTORY"}, "events": False, "staff": True}
    planned = Module.objects.get(code="CMS")
    with pytest.raises(ValidationError):
        enable_module_for_site(informatics.pk, planned.pk)
