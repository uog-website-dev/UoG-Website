"""Event Management settings: module gates, RBAC, Site isolation and validation."""
import pytest
from django.db import IntegrityError, transaction

from apps.sites.models import Module, Site, SiteEventSettings
from apps.sites.services.modules import disable_module_for_site, enable_module_for_site
from tests.test_site_appearance_api import owner, _site_admin_client  # noqa: F401

pytestmark = pytest.mark.django_db


def _enable_events(site):
    enable_module_for_site(site.pk, Module.objects.get(code="EVENTS").pk)


def test_event_settings_are_scoped_validated_and_preconditioned(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    a = Site.objects.create(code="EVENT-A", name="Site A", organization_unit=owner)
    b = Site.objects.create(code="EVENT-B", name="Site B", organization_unit=owner)
    _enable_events(a)
    _enable_events(b)
    actor = _site_admin_client(client, oidc, a)
    url = f"/api/v1/sites/{a.pk}/event-settings/"

    initial = client.get(url)
    assert initial.status_code == 200, initial.content
    body = initial.json()
    assert body["settings"] == {
        "timezone": "Africa/Addis_Ababa",
        "public_list_path": "/events",
        "registration_required_by_default": False,
        "registration_default_capacity": None,
        "public_aggregation_eligible": False,
    }
    assert body["aggregation_write_access"] is False
    assert "EVENTS" in body["modules"]
    assert not SiteEventSettings.objects.exists()

    payload = {
        "timezone": "Africa/Nairobi",
        "public_list_path": "/campus/events",
        "registration_required_by_default": True,
        "registration_default_capacity": 100,
        "public_aggregation_eligible": True,
    }
    saved = client.patch(url, payload, content_type="application/json", HTTP_IF_MATCH=initial["ETag"])
    assert saved.status_code == 200, saved.content
    assert saved.json()["version"] == 1
    assert saved.json()["settings"]["timezone"] == "Africa/Nairobi"
    assert saved.json()["aggregation_write_access"] is False
    assert not SiteEventSettings.objects.filter(site=b).exists()

    stale = client.patch(url, {"timezone": "UTC"}, content_type="application/json", HTTP_IF_MATCH=initial["ETag"])
    assert stale.status_code == 412
    missing = client.patch(url, {"timezone": "UTC"}, content_type="application/json")
    assert missing.status_code == 428

    etag = client.get(url)["ETag"]
    for invalid in (
        {"timezone": "Not/AZone"},
        {"timezone": ""},
        {"public_list_path": "/"},
        {"public_list_path": "/Bad Path"},
        {"public_list_path": "events"},
        {"registration_required_by_default": "maybe"},
        {"registration_default_capacity": 0},
        {"registration_default_capacity": "ten"},
        {"public_aggregation_eligible": "sometimes"},
        {"site": b.pk},
        {"version": 99},
    ):
        response = client.patch(url, invalid, content_type="application/json", HTTP_IF_MATCH=etag)
        assert response.status_code == 400, (invalid, response.content)

    row = SiteEventSettings.objects.get(site=a)
    assert row.public_list_path == "/campus/events" and row.updated_by == actor
    from apps.audit.models import AuditEvent
    event = AuditEvent.objects.get(action="SITE_EVENT_SETTINGS_CREATED", entity_id=str(a.pk))
    assert event.actor_id == str(actor.pk)

    with pytest.raises(IntegrityError), transaction.atomic():
        SiteEventSettings.objects.filter(site=a).update(site=b)

    assert client.get(f"/api/v1/sites/{b.pk}/event-settings/").status_code == 403

    client.defaults.clear()
    assert client.get(url).status_code in (401, 403)


def test_disabled_events_block_writes_and_hide_settings(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="EVENT-OFF", name="Events Off", organization_unit=owner)
    _enable_events(site)
    _site_admin_client(client, oidc, site)
    url = f"/api/v1/sites/{site.pk}/event-settings/"
    initial = client.get(url)
    assert initial.status_code == 200
    saved = client.patch(
        url,
        {"timezone": "UTC", "public_aggregation_eligible": True},
        content_type="application/json",
        HTTP_IF_MATCH=initial["ETag"],
    )
    assert saved.status_code == 200, saved.content
    assert SiteEventSettings.objects.filter(site=site).exists()

    disable_module_for_site(site.pk, Module.objects.get(code="EVENTS").pk)
    assert client.get(url).status_code == 403
    blocked = client.patch(
        url, {"timezone": "Africa/Addis_Ababa"}, content_type="application/json",
        HTTP_IF_MATCH=saved["ETag"],
    )
    assert blocked.status_code == 403
    assert SiteEventSettings.objects.filter(site=site).exists()


def test_event_categories_are_site_scoped_and_module_gated(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    a = Site.objects.create(code="EVENT-CAT-A", name="Cat A", organization_unit=owner)
    b = Site.objects.create(code="EVENT-CAT-B", name="Cat B", organization_unit=owner)
    _enable_events(a)
    _enable_events(b)
    _site_admin_client(client, oidc, a)
    url = f"/api/v1/sites/{a.pk}/event-categories/"

    created = client.post(url, {"name": "Lectures"}, content_type="application/json")
    assert created.status_code == 201, created.content
    payload = created.json()
    assert payload["slug"] == "lectures"
    assert payload["code"].startswith("EVT_")

    listed = client.get(url)
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    assert client.get(f"/api/v1/sites/{b.pk}/event-categories/").status_code == 403
    assert client.post(
        f"/api/v1/sites/{b.pk}/event-categories/",
        {"name": "Stolen"}, content_type="application/json",
    ).status_code == 403

    disable_module_for_site(a.pk, Module.objects.get(code="EVENTS").pk)
    assert client.get(url).status_code == 403
    assert client.post(url, {"name": "Blocked"}, content_type="application/json").status_code == 403


def test_aggregation_eligibility_never_grants_cross_site_write(client, oidc, owner, settings):
    """University Main aggregation is a read-side policy flag only."""
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    college = Site.objects.create(code="EVENT-COLLEGE", name="College", organization_unit=owner)
    main = Site.objects.create(code="EVENT-MAIN", name="University Main", organization_unit=owner)
    _enable_events(college)
    _enable_events(main)
    college_admin = _site_admin_client(client, oidc, college)
    college_url = f"/api/v1/sites/{college.pk}/event-settings/"
    initial = client.get(college_url)
    saved = client.patch(
        college_url,
        {"public_aggregation_eligible": True},
        content_type="application/json",
        HTTP_IF_MATCH=initial["ETag"],
    )
    assert saved.status_code == 200
    assert saved.json()["aggregation_write_access"] is False

    # A Main Site Administrator cannot read or change the college Site's private settings.
    client.defaults.clear()
    _site_admin_client(client, oidc, main)
    assert client.get(college_url).status_code == 403
    assert client.patch(
        college_url,
        {"timezone": "UTC"},
        content_type="application/json",
        HTTP_IF_MATCH=saved["ETag"],
    ).status_code == 403
    assert SiteEventSettings.objects.get(site=college).updated_by_id == college_admin.pk


def test_public_site_context_includes_events_only_when_enabled(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    from apps.sites.models import SiteDomain
    from apps.sites.services.lifecycle import activate_site

    site = Site.objects.create(code="EVENT-PUBLIC", name="Public Events", organization_unit=owner)
    activate_site(site.pk)
    SiteDomain.objects.create(site=site, hostname="events-public.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_events(site)
    _site_admin_client(client, oidc, site)
    url = f"/api/v1/sites/{site.pk}/event-settings/"
    initial = client.get(url)
    client.patch(
        url,
        {"public_list_path": "/happenings", "public_aggregation_eligible": True},
        content_type="application/json",
        HTTP_IF_MATCH=initial["ETag"],
    )

    client.defaults.clear()
    public = client.get("/api/v1/site-context/", HTTP_HOST="events-public.uog.edu.et")
    assert public.status_code == 200
    assert "EVENTS" in public.json()["modules"]
    assert public.json()["configuration"]["events"]["public_list_path"] == "/happenings"

    disable_module_for_site(site.pk, Module.objects.get(code="EVENTS").pk)
    hidden = client.get("/api/v1/site-context/", HTTP_HOST="events-public.uog.edu.et")
    assert hidden.status_code == 200
    assert "EVENTS" not in hidden.json()["modules"]
    assert "events" not in hidden.json()["configuration"]
