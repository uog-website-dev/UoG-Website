"""Versioned Site configuration: defaults, isolation, rejection and audit."""
import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from apps.audit.models import AuditEvent
from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.sites.configuration import CURRENT_SCHEMA_VERSION, default_configuration, upgrade_configuration
from apps.sites.models import Site
from apps.sites.services.configuration import apply_site_configuration
from apps.sites.services.lifecycle import activate_site

pytestmark = pytest.mark.django_db


@pytest.fixture
def owners():
    university, _ = OrganizationType.objects.get_or_create(code="UNIVERSITY", defaults={"name": "University"})
    college, _ = OrganizationType.objects.get_or_create(code="COLLEGE", defaults={"name": "College"})
    root = OrganizationUnit.objects.create(code="UOG", name="University of Gondar", organization_type=university)
    informatics = OrganizationUnit.objects.create(code="CI", name="College of Informatics", organization_type=college, parent=root)
    return root, informatics


def create_site(owner, code, **overrides):
    return Site.objects.create(organization_unit=owner, code=code, name=f"{code} website", **overrides)


def test_new_site_persists_independent_schema_defaults(owners):
    root, college = owners
    first = create_site(college, "INFORMATICS")
    second = create_site(root, "MAIN", default_language="am")
    first.refresh_from_db()
    second.refresh_from_db()
    assert first.configuration == default_configuration("en-us")
    assert second.configuration["schema_version"] == CURRENT_SCHEMA_VERSION
    assert second.configuration["language"]["enabled"] == ["am"]
    assert second.configuration["identity"]["logo_ref"] is None
    assert first.configuration is not second.configuration


def test_partial_update_changes_only_the_selected_site(owners):
    college = owners[1]
    target = create_site(college, "TARGET")
    other = create_site(college, "OTHER")
    original = other.configuration
    updated = apply_site_configuration(target.pk, {
        "identity": {"display_name": "College of Informatics", "logo_ref": "logo-informatics"},
        "presentation": {"theme": "high-contrast"},
        "language": {"enabled": ["en-us", "am"]},
        "navigation": {"items": [{"code": "HOME", "label": "Home", "path": "/"}]},
        "behavior": {"show_search": True},
    })
    updated.refresh_from_db()
    other.refresh_from_db()
    assert updated.configuration["identity"]["display_name"] == "College of Informatics"
    assert updated.configuration["identity"]["favicon_ref"] is None
    assert updated.configuration["presentation"]["theme"] == "high-contrast"
    assert updated.configuration["language"]["enabled"] == ["en-us", "am"]
    assert updated.configuration["navigation"]["items"][0]["path"] == "/"
    assert updated.configuration["behavior"] == {"show_search": True, "show_language_switcher": False}
    assert other.configuration == original


@pytest.mark.parametrize("changes", [
    {"analytics_token": "abc"},
    {"identity": {"password": "hunter2"}},
    {"presentation": {"theme": "custom-css"}},
    {"presentation": {"primary_color": "#fff"}},
    {"behavior": {"show_search": "yes"}},
    {"language": {"enabled": ["en"]}},
    {"identity": {"logo_ref": "https://cdn.example/logo.png"}},
    {"navigation": {"items": [{"code": "HOME", "label": "Home", "path": "javascript:alert(1)"}]}},
    {"schema_version": 2},
    {"schema_version": 0, "custom": True},
])
def test_invalid_configuration_is_rejected(owners, changes):
    site = create_site(owners[1], "INVALID")
    original = site.configuration
    with pytest.raises(ValidationError):
        apply_site_configuration(site.pk, changes)
    site.refresh_from_db()
    assert site.configuration == original


def test_database_rejects_an_unallowlisted_document(owners):
    site = create_site(owners[1], "SQL")
    with pytest.raises(IntegrityError), transaction.atomic():
        Site.objects.filter(pk=site.pk).update(configuration={"schema_version": 1, "custom": True})
    assert Site.objects.get(pk=site.pk).configuration == default_configuration("en-us")


def test_configuration_changes_are_audited_and_status_changes_are_not(owners):
    site = create_site(owners[1], "AUDITED")
    created = AuditEvent.objects.get(entity_type="sites.site", entity_id=str(site.pk))
    assert created.action == "SITE_CONFIGURATION_CREATED"
    assert created.before is None
    assert created.after == site.configuration
    assert "password" not in str(created.after)
    apply_site_configuration(site.pk, {"identity": {"display_name": "Informatics"}})
    updated = AuditEvent.objects.filter(entity_type="sites.site", entity_id=str(site.pk), action="SITE_CONFIGURATION_UPDATED").get()
    assert updated.before["identity"]["display_name"] is None
    assert updated.after["identity"]["display_name"] == "Informatics"
    assert updated.changed_fields == ["identity"]
    activate_site(site.pk)
    assert AuditEvent.objects.filter(entity_type="sites.site", entity_id=str(site.pk)).count() == 2


def test_current_schema_round_trips_and_exposes_an_upgrade_path():
    document = default_configuration("en-us")
    assert upgrade_configuration(document, default_language="en-us") == document
    assert upgrade_configuration({}, default_language="am") == default_configuration("am")
    assert CURRENT_SCHEMA_VERSION == 1
