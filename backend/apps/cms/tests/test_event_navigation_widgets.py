"""Events menu destination + Loop Grid events source (no new Calendar widget)."""
from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone

from apps.cms.event_models import Event, EventStatus
from apps.cms.models import MenuItem
from apps.cms.tests.test_menu_api import api, ready, _menu, _post, _tag  # noqa: F401
from apps.cms.tests.test_public_posts import _host
from apps.sites.models import Module, Site, SiteDomain
from apps.sites.services.lifecycle import activate_site
from apps.sites.services.modules import disable_module_for_site, enable_module_for_site
from tests.test_site_appearance_api import owner, _site_admin_client  # noqa: F401

pytestmark = pytest.mark.django_db


def enable(api, code):
    enable_module_for_site(api.site.pk, Module.objects.get(code=code).pk)


def view(api, host):
    result = api.client.get("/api/v1/site-context/menus/?location=header", HTTP_HOST=host)
    assert result.status_code == 200, result.content
    return result.json()["locations"]["header"]


def publish(api, url):
    return _post(api, url + "activate/", {}, _tag(api, url))


def _enable_events(site):
    enable_module_for_site(site.pk, Module.objects.get(code="EVENTS").pk)


def _event(site, **overrides):
    start = timezone.now().replace(microsecond=0) + timedelta(days=2)
    payload = {
        "site": site,
        "title": "Public lecture",
        "slug": f"lecture-{uuid4().hex[:8]}",
        "summary": "Open to visitors",
        "description": "<p>Details</p>",
        "status": EventStatus.PUBLISHED,
        "published_at": timezone.now(),
        "starts_at": start,
        "ends_at": start + timedelta(hours=2),
        "timezone": "Africa/Addis_Ababa",
        "venue": "Main Hall",
    }
    payload.update(overrides)
    return Event.objects.create(**payload)


def test_events_menu_destination_routes_and_hides_when_disabled(api):
    enable(api, "EVENTS")
    url = _menu(api)
    item = _post(api, url + "items/", {"label": "Events & Calendar", "item_type": "events"}, _tag(api, url))
    assert item.status_code == 201, item.content
    assert item.json()["destination_status"] == "ready"
    assert item.json()["item_type"] == "events"
    host = _host(api.site)
    assert publish(api, url).status_code == 200
    assert view(api, host)[0]["href"] == "/events"
    targets = api.client.get(api.base + "targets/", **api.header).json()
    assert targets["eventsAvailable"] is True

    disable_module_for_site(api.site.pk, Module.objects.get(code="EVENTS").pk)
    assert view(api, host) == []
    assert api.client.get(api.base + "targets/", **api.header).json()["eventsAvailable"] is False


def test_events_destination_rejected_without_module(api):
    url = _menu(api)
    before = MenuItem.objects.count()
    token = _tag(api, url)
    denied = _post(api, url + "items/", {"label": "Events", "item_type": "events"}, token)
    assert denied.status_code == 400
    assert MenuItem.objects.count() == before


def test_loop_grid_events_source_filters_idor_and_module_gate(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site_a = Site.objects.create(code="EVT-WA", name="Widget A", organization_unit=owner)
    site_b = Site.objects.create(code="EVT-WB", name="Widget B", organization_unit=owner)
    activate_site(site_a.pk)
    activate_site(site_b.pk)
    SiteDomain.objects.create(site=site_a, hostname="evt-wa.uog.edu.et", is_primary=True, status="ACTIVE")
    SiteDomain.objects.create(site=site_b, hostname="evt-wb.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_events(site_a)
    _enable_events(site_b)

    published = _event(site_a, title="Campus day", slug="campus-day")
    draft = _event(site_a, title="Secret draft", slug="secret-draft", status=EventStatus.DRAFT, published_at=None)
    foreign = _event(site_b, title="Other college", slug="other-college")

    listed = client.get(
        "/api/v1/site-context/widgets/?source=events&limit=5&lifecycle=upcoming",
        HTTP_HOST="evt-wa.uog.edu.et",
    )
    assert listed.status_code == 200, listed.content
    rows = listed.json()["results"]
    ids = {row["id"] for row in rows}
    assert str(published.pk) in ids
    assert str(draft.pk) not in ids
    assert str(foreign.pk) not in ids
    assert all(row["site"] == site_a.pk for row in rows)
    assert all("status" not in row for row in rows)
    assert rows[0]["href"].startswith("/events/")

    filtered = client.get(
        f"/api/v1/site-context/widgets/?source=events&limit=5&category={published.slug}",
        HTTP_HOST="evt-wa.uog.edu.et",
    )
    # Unknown category slug yields empty, not foreign leakage.
    assert filtered.status_code == 200
    assert filtered.json()["results"] == []

    disable_module_for_site(site_a.pk, Module.objects.get(code="EVENTS").pk)
    gated = client.get(
        "/api/v1/site-context/widgets/?source=events&limit=5",
        HTTP_HOST="evt-wa.uog.edu.et",
    )
    assert gated.status_code == 404
