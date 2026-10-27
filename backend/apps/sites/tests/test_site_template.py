"""Templates copy approved defaults once and do not rewrite existing Sites."""
from pathlib import Path

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.sites.configuration import default_configuration
from apps.sites.models import Site, SiteTemplate
from apps.sites.services.configuration import apply_site_configuration
from apps.sites.services.templates import provision_site

pytestmark = pytest.mark.django_db

INITIAL_CODES = {
    "UNIVERSITY_MAIN", "COLLEGE", "RESEARCH_CENTER", "DIRECTORATE", "ADMINISTRATIVE_UNIT", "GENERAL",
}


@pytest.fixture
def owner():
    college, _ = OrganizationType.objects.get_or_create(code="COLLEGE", defaults={"name": "College"})
    university, _ = OrganizationType.objects.get_or_create(code="UNIVERSITY", defaults={"name": "University"})
    root = OrganizationUnit.objects.create(code="UOG", name="University of Gondar", organization_type=university)
    return OrganizationUnit.objects.create(code="CI", name="College of Informatics", organization_type=college, parent=root)


@pytest.fixture
def college_template():
    document = default_configuration("en-us")
    document["presentation"]["theme"] = "high-contrast"
    document["navigation"]["items"] = [{"code": "ABOUT", "label": "About", "path": "/about"}]
    document["behavior"]["show_search"] = True
    template = SiteTemplate(
        code="college_custom", name="Custom college", description="A college starting point.",
        status=SiteTemplate.Status.ACTIVE, default_configuration=document,
    )
    template.save()
    return template


def test_template_fields_catalog_and_no_module_writes(college_template):
    college_template.refresh_from_db()
    assert college_template.code == "COLLEGE_CUSTOM"
    assert college_template.name == "Custom college"
    assert college_template.description == "A college starting point."
    assert college_template.default_configuration["navigation"]["items"][0]["code"] == "ABOUT"
    assert INITIAL_CODES <= set(SiteTemplate.objects.values_list("code", flat=True))
    assert not hasattr(SiteTemplate, "enabled_modules")
    source = Path(provision_site.__code__.co_filename).read_text(encoding="utf-8")
    assert not any(code in source for code in INITIAL_CODES)


def test_inactive_template_cannot_be_selected_and_invalid_templates_are_rejected(owner):
    inactive = SiteTemplate.objects.create(code="RETIRED", name="Retired", description="Not available for new websites.")
    with pytest.raises(ValidationError):
        provision_site(organization_unit=owner, code="NEW", name="New website", template=inactive)
    with pytest.raises(ValidationError):
        Site.objects.create(organization_unit=owner, code="DIRECT", name="Direct", template=inactive)
    with pytest.raises(ValidationError):
        SiteTemplate.objects.create(code="RETIRED", name="Duplicate", description="Same code.")
    with pytest.raises(ValidationError):
        SiteTemplate.objects.create(code="EMPTY", name=" ", description="Missing name.")
    with pytest.raises(ValidationError):
        SiteTemplate.objects.create(code="NODESCRIPTION", name="Named", description="  ")
    with pytest.raises(ValidationError):
        SiteTemplate.objects.create(code="SECRET", name="Secret", description="No secrets.", default_configuration={"password": "hidden"})
    inactive.code = "RENAMED"
    with pytest.raises(ValidationError):
        inactive.save()


def test_provisioning_copies_defaults_and_later_edits_do_not_propagate(owner, college_template):
    original = college_template.default_configuration
    site = provision_site(
        organization_unit=owner, code="INFORMATICS", name="Informatics", template=college_template,
        default_language="am", configuration={"identity": {"display_name": "Informatics"}},
    )
    other = Site.objects.create(organization_unit=owner, code="PORTAL", name="Portal", template=college_template, default_language="am")
    site.refresh_from_db()
    other.refresh_from_db()
    college_template.refresh_from_db()
    assert site.template_id == college_template.pk
    assert site.configuration["presentation"]["theme"] == "high-contrast"
    assert site.configuration["navigation"]["items"][0]["path"] == "/about"
    assert site.configuration["identity"]["display_name"] == "Informatics"
    assert site.configuration["language"]["enabled"] == ["en-us", "am"]
    assert other.configuration["identity"]["display_name"] is None
    assert other.configuration["language"]["enabled"] == ["en-us", "am"]
    assert site.configuration != other.configuration
    assert college_template.default_configuration == original
    assert "am" not in college_template.default_configuration["language"]["enabled"]

    college_template.default_configuration = default_configuration("en-us")
    college_template.save(update_fields=["default_configuration"])
    college_template.status = SiteTemplate.Status.INACTIVE
    college_template.save(update_fields=["status"])
    site.refresh_from_db()
    assert site.configuration["presentation"]["theme"] == "high-contrast"
    assert site.template_id == college_template.pk
    apply_site_configuration(site.pk, {"behavior": {"show_language_switcher": True}})
    site.refresh_from_db()
    other.refresh_from_db()
    assert site.configuration["behavior"]["show_language_switcher"] is True
    assert other.configuration["behavior"]["show_language_switcher"] is False

    with pytest.raises(ValidationError):
        Site.objects.create(organization_unit=owner, code="LATER", name="Later", template=college_template)
    active = SiteTemplate.objects.get(code="GENERAL")
    site.template = active
    site.save(update_fields=["template"])
    site.refresh_from_db()
    assert site.template_id == active.pk
    assert site.configuration["presentation"]["theme"] == "high-contrast"
    site.template = college_template
    with pytest.raises(ValidationError):
        site.save(update_fields=["template"])


def test_database_rejects_inactive_selection_and_invalid_template_documents(owner, college_template):
    site = provision_site(organization_unit=owner, code="MEDICINE", name="Medicine", template=college_template)
    inactive = SiteTemplate.objects.create(code="DORMANT", name="Dormant", description="Unavailable.")
    with pytest.raises(IntegrityError), transaction.atomic():
        Site.objects.filter(pk=site.pk).update(template_id=inactive.pk)
    with pytest.raises(IntegrityError), transaction.atomic():
        SiteTemplate.objects.filter(pk=college_template.pk).update(default_configuration={"schema_version": 1, "custom": True})
    site.refresh_from_db()
    college_template.refresh_from_db()
    assert site.template_id == college_template.pk
    assert site.configuration["navigation"]["items"][0]["code"] == "ABOUT"
    assert college_template.default_configuration["navigation"]["items"][0]["code"] == "ABOUT"
