"""Staff Directory settings: module gates, RBAC, Site isolation, scope and validation."""
import pytest
from django.db import IntegrityError, transaction

from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.sites.models import Module, Site, SiteStaffDirectorySettings
from apps.sites.services.modules import disable_module_for_site, enable_module_for_site
from apps.sites.staff import resolve_directory_organization_scope
from tests.test_site_appearance_api import owner, _site_admin_client  # noqa: F401

pytestmark = pytest.mark.django_db


def _enable_staff(site):
    enable_module_for_site(site.pk, Module.objects.get(code="STAFF_DIRECTORY").pk)


def test_staff_directory_settings_are_scoped_validated_and_preconditioned(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    a = Site.objects.create(code="STAFF-A", name="Site A", organization_unit=owner)
    b = Site.objects.create(code="STAFF-B", name="Site B", organization_unit=owner)
    _enable_staff(a)
    _enable_staff(b)
    actor = _site_admin_client(client, oidc, a)
    url = f"/api/v1/sites/{a.pk}/staff-directory-settings/"

    initial = client.get(url)
    assert initial.status_code == 200, initial.content
    body = initial.json()
    assert body["settings"] == {
        "page_size": 20,
        "default_sort": "NAME_ASC",
        "public_list_path": "/staff",
        "presentation": "LIST",
        "public_aggregation_eligible": False,
    }
    assert body["aggregation_write_access"] is False
    assert body["scope"]["organization_unit_id"] == owner.pk
    assert owner.pk in body["scope"]["organization_ids"]
    assert body["scope"]["mode"] == "mapped_organization"
    assert "STAFF_DIRECTORY" in body["modules"]
    assert not SiteStaffDirectorySettings.objects.exists()

    payload = {
        "page_size": 40,
        "default_sort": "TITLE_ASC",
        "public_list_path": "/about/staff",
        "presentation": "CARDS",
        "public_aggregation_eligible": True,
    }
    saved = client.patch(url, payload, content_type="application/json", HTTP_IF_MATCH=initial["ETag"])
    assert saved.status_code == 200, saved.content
    assert saved.json()["version"] == 1
    assert saved.json()["settings"]["public_list_path"] == "/about/staff"
    assert saved.json()["aggregation_write_access"] is False
    assert not SiteStaffDirectorySettings.objects.filter(site=b).exists()

    stale = client.patch(url, {"page_size": 10}, content_type="application/json", HTTP_IF_MATCH=initial["ETag"])
    assert stale.status_code == 412
    missing = client.patch(url, {"page_size": 10}, content_type="application/json")
    assert missing.status_code == 428

    etag = client.get(url)["ETag"]
    for invalid in (
        {"page_size": 4},
        {"page_size": 101},
        {"page_size": "twenty"},
        {"default_sort": "POPULARITY"},
        {"public_list_path": "/"},
        {"public_list_path": "/Bad Path"},
        {"public_list_path": "staff"},
        {"presentation": "GRID"},
        {"public_aggregation_eligible": "sometimes"},
        {"site": b.pk},
        {"version": 99},
    ):
        response = client.patch(url, invalid, content_type="application/json", HTTP_IF_MATCH=etag)
        assert response.status_code == 400, (invalid, response.content)

    row = SiteStaffDirectorySettings.objects.get(site=a)
    assert row.presentation == "CARDS" and row.updated_by == actor
    from apps.audit.models import AuditEvent
    event = AuditEvent.objects.get(action="SITE_STAFF_DIRECTORY_SETTINGS_CREATED", entity_id=str(a.pk))
    assert event.actor_id == str(actor.pk)

    with pytest.raises(IntegrityError), transaction.atomic():
        SiteStaffDirectorySettings.objects.filter(site=a).update(site=b)

    assert client.get(f"/api/v1/sites/{b.pk}/staff-directory-settings/").status_code == 403

    client.defaults.clear()
    assert client.get(url).status_code in (401, 403)


def test_disabled_staff_directory_blocks_writes_and_retains_settings(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="STAFF-OFF", name="Staff Off", organization_unit=owner)
    _enable_staff(site)
    _site_admin_client(client, oidc, site)
    url = f"/api/v1/sites/{site.pk}/staff-directory-settings/"
    initial = client.get(url)
    assert initial.status_code == 200
    saved = client.patch(
        url,
        {"page_size": 25, "public_aggregation_eligible": True},
        content_type="application/json",
        HTTP_IF_MATCH=initial["ETag"],
    )
    assert saved.status_code == 200, saved.content
    assert SiteStaffDirectorySettings.objects.filter(site=site).exists()

    disable_module_for_site(site.pk, Module.objects.get(code="STAFF_DIRECTORY").pk)
    assert client.get(url).status_code == 403
    blocked = client.patch(
        url, {"page_size": 20}, content_type="application/json",
        HTTP_IF_MATCH=saved["ETag"],
    )
    assert blocked.status_code == 403
    assert SiteStaffDirectorySettings.objects.filter(site=site).exists()


def test_college_scope_includes_mapped_organization_and_descendants(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    department_type, _ = OrganizationType.objects.get_or_create(
        code="DEPARTMENT", defaults={"name": "Department"},
    )
    department = OrganizationUnit.objects.create(
        code="STAFF-DEPT", name="Computer Science", organization_type=department_type, parent=owner,
    )
    site = Site.objects.create(code="STAFF-COLLEGE", name="College Staff", organization_unit=owner)
    _enable_staff(site)
    _site_admin_client(client, oidc, site)
    response = client.get(f"/api/v1/sites/{site.pk}/staff-directory-settings/")
    assert response.status_code == 200, response.content
    scope = response.json()["scope"]
    assert scope["mode"] == "mapped_organization"
    assert scope["organization_unit_id"] == owner.pk
    assert set(scope["organization_ids"]) >= {owner.pk, department.pk}
    assert scope["aggregation_site_ids"] == []

    resolved = resolve_directory_organization_scope(site)
    assert resolved["mode"] == "mapped_organization"
    assert set(resolved["organization_ids"]) >= {owner.pk, department.pk}


def test_main_aggregation_only_includes_eligible_configured_sites(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    university = owner.parent
    assert university is not None
    college = Site.objects.create(code="STAFF-AGG-C", name="Eligible College", organization_unit=owner)
    other = Site.objects.create(code="STAFF-AGG-O", name="Ineligible College", organization_unit=owner)
    main = Site.objects.create(
        code="STAFF-AGG-M", name="University Main", organization_unit=university, is_main=True,
    )
    _enable_staff(college)
    _enable_staff(other)
    _enable_staff(main)

    college_admin = _site_admin_client(client, oidc, college)
    college_url = f"/api/v1/sites/{college.pk}/staff-directory-settings/"
    initial = client.get(college_url)
    saved = client.patch(
        college_url,
        {"public_aggregation_eligible": True},
        content_type="application/json",
        HTTP_IF_MATCH=initial["ETag"],
    )
    assert saved.status_code == 200
    assert saved.json()["aggregation_write_access"] is False

    client.defaults.clear()
    _site_admin_client(client, oidc, main)
    main_body = client.get(f"/api/v1/sites/{main.pk}/staff-directory-settings/").json()
    assert main_body["scope"]["mode"] == "main_with_eligible_aggregation"
    assert college.pk in main_body["scope"]["aggregation_site_ids"]
    assert other.pk not in main_body["scope"]["aggregation_site_ids"]

    # Main admin cannot read or change the college Site's private settings (AC05).
    assert client.get(college_url).status_code == 403
    assert client.patch(
        college_url,
        {"page_size": 10},
        content_type="application/json",
        HTTP_IF_MATCH=saved["ETag"],
    ).status_code == 403
    assert SiteStaffDirectorySettings.objects.get(site=college).updated_by_id == college_admin.pk


def test_public_site_context_includes_staff_directory_only_when_enabled(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    from apps.sites.models import SiteDomain
    from apps.sites.services.lifecycle import activate_site

    site = Site.objects.create(code="STAFF-PUBLIC", name="Public Staff", organization_unit=owner)
    activate_site(site.pk)
    SiteDomain.objects.create(site=site, hostname="staff-public.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_staff(site)
    _site_admin_client(client, oidc, site)
    url = f"/api/v1/sites/{site.pk}/staff-directory-settings/"
    initial = client.get(url)
    client.patch(
        url,
        {"public_list_path": "/people", "public_aggregation_eligible": True},
        content_type="application/json",
        HTTP_IF_MATCH=initial["ETag"],
    )

    client.defaults.clear()
    public = client.get("/api/v1/site-context/", HTTP_HOST="staff-public.uog.edu.et")
    assert public.status_code == 200
    assert "STAFF_DIRECTORY" in public.json()["modules"]
    assert public.json()["configuration"]["staff_directory"]["public_list_path"] == "/people"

    disable_module_for_site(site.pk, Module.objects.get(code="STAFF_DIRECTORY").pk)
    hidden = client.get("/api/v1/site-context/", HTTP_HOST="staff-public.uog.edu.et")
    assert hidden.status_code == 200
    assert "STAFF_DIRECTORY" not in hidden.json()["modules"]
    assert "staff_directory" not in hidden.json()["configuration"]
    assert SiteStaffDirectorySettings.objects.filter(site=site).exists()
