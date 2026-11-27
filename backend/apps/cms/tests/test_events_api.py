"""Event CRUD, publication, validation, banner ownership and cross-Site isolation."""
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.api.models import Category
from apps.cms.event_models import Event, EventStatus
from apps.media.models import MediaAsset
from apps.media.services import _media_write_session
from apps.sites.models import Module, Site, SiteDomain
from apps.sites.services.lifecycle import activate_site
from apps.sites.services.modules import disable_module_for_site, enable_module_for_site
from tests.test_site_appearance_api import owner, _site_admin_client  # noqa: F401

pytestmark = pytest.mark.django_db


def _enable_events(site):
    enable_module_for_site(site.pk, Module.objects.get(code="EVENTS").pk)


def _ready_image(site, user):
    with _media_write_session(user, site.pk):
        asset = MediaAsset.objects.create(
            site=site,
            storage_reference=f"platform-private:sites/{site.pk}/logo/{uuid.uuid4()}",
            original_filename="banner.png",
            detected_mime="image/png",
            byte_count=128,
            checksum="b" * 64,
            status="PENDING",
            width=800,
            height=400,
            created_by=user,
            updated_by=user,
        )
        asset.status = "READY"
        asset.save(update_fields=("status",))
    return asset


def _base_payload(**overrides):
    start = timezone.now() + timedelta(days=2)
    end = start + timedelta(hours=2)
    payload = {
        "title": "Convocation",
        "summary": "Annual ceremony",
        "description": "<p>Celebrate graduates safely.</p>",
        "starts_at": start.isoformat(),
        "ends_at": end.isoformat(),
        "timezone": "Africa/Addis_Ababa",
        "format": "PHYSICAL",
        "venue": "Main Hall",
    }
    payload.update(overrides)
    return payload


def test_event_draft_publish_validation_and_concurrency(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="EVT-CRUD", name="Events Site", organization_unit=owner)
    _enable_events(site)
    actor = _site_admin_client(client, oidc, site)
    url = f"/api/v1/sites/{site.pk}/events/"

    draft = client.post(url, {"title": "Incomplete"}, content_type="application/json")
    assert draft.status_code == 201, draft.content
    event_id = draft.json()["id"]
    assert draft.json()["status"] == "DRAFT"
    etag = draft["ETag"]

    publish = client.post(
        f"{url}{event_id}/publish/", {}, content_type="application/json", HTTP_IF_MATCH=etag,
    )
    assert publish.status_code == 400
    details = publish.json().get("error", {}).get("details", publish.json())
    assert any(key in details for key in ("starts_at", "ends_at", "summary", "description", "venue"))

    saved = client.patch(
        f"{url}{event_id}/",
        _base_payload(),
        content_type="application/json",
        HTTP_IF_MATCH=etag,
    )
    assert saved.status_code == 200, saved.content
    etag = saved["ETag"]

    stale = client.patch(
        f"{url}{event_id}/",
        {"title": "Lost"},
        content_type="application/json",
        HTTP_IF_MATCH='"site-event-stale"',
    )
    assert stale.status_code == 412

    published = client.post(
        f"{url}{event_id}/publish/", {}, content_type="application/json", HTTP_IF_MATCH=etag,
    )
    assert published.status_code == 200, published.content
    assert published.json()["status"] == "PUBLISHED"
    assert Event.objects.get(pk=event_id).updated_by_id == actor.pk


def test_event_end_before_start_and_dst_window(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="EVT-DST", name="DST Site", organization_unit=owner)
    _enable_events(site)
    _site_admin_client(client, oidc, site)
    url = f"/api/v1/sites/{site.pk}/events/"

    bad = client.post(url, _base_payload(
        starts_at="2026-03-08T10:00:00+03:00",
        ends_at="2026-03-08T09:00:00+03:00",
    ), content_type="application/json")
    assert bad.status_code == 400

    # US DST spring-forward window stored as aware UTC bounds.
    start = datetime(2026, 3, 8, 1, 30, tzinfo=ZoneInfo("America/New_York"))
    end = datetime(2026, 3, 8, 4, 0, tzinfo=ZoneInfo("America/New_York"))
    ok = client.post(url, _base_payload(
        title="DST Session",
        starts_at=start.isoformat(),
        ends_at=end.isoformat(),
        timezone="America/New_York",
    ), content_type="application/json")
    assert ok.status_code == 201, ok.content
    event = Event.objects.get(pk=ok.json()["id"])
    assert event.ends_at > event.starts_at
    assert event.timezone == "America/New_York"


def test_event_rich_text_xss_is_sanitized(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="EVT-XSS", name="XSS Site", organization_unit=owner)
    _enable_events(site)
    _site_admin_client(client, oidc, site)
    created = client.post(
        f"/api/v1/sites/{site.pk}/events/",
        _base_payload(description='<p>Hello<script>alert(1)</script><a href="javascript:alert(1)">x</a></p>'),
        content_type="application/json",
    )
    assert created.status_code == 201, created.content
    html = created.json()["description"]
    assert "<script" not in html.lower()
    assert "javascript:" not in html.lower()
    assert "Hello" in html


def test_banner_must_be_site_owned(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    a = Site.objects.create(code="EVT-BAN-A", name="Banner A", organization_unit=owner)
    b = Site.objects.create(code="EVT-BAN-B", name="Banner B", organization_unit=owner)
    _enable_events(a)
    _enable_events(b)
    actor_a = _site_admin_client(client, oidc, a)
    foreign = _ready_image(b, actor_a)
    local = _ready_image(a, actor_a)

    rejected = client.post(
        f"/api/v1/sites/{a.pk}/events/",
        _base_payload(banner_asset=str(foreign.pk)),
        content_type="application/json",
    )
    assert rejected.status_code == 400

    accepted = client.post(
        f"/api/v1/sites/{a.pk}/events/",
        _base_payload(title="Local banner", banner_asset=str(local.pk)),
        content_type="application/json",
    )
    assert accepted.status_code == 201, accepted.content
    assert accepted.json()["banner_asset"] == str(local.pk)


def test_cancel_closes_registration_and_public_hides_drafts(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="EVT-PUB", name="Public Events", organization_unit=owner)
    activate_site(site.pk)
    SiteDomain.objects.create(site=site, hostname="events-crud.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_events(site)
    _site_admin_client(client, oidc, site)
    url = f"/api/v1/sites/{site.pk}/events/"

    draft = client.post(url, _base_payload(title="Hidden Draft", slug="hidden-draft"), content_type="application/json")
    live = client.post(url, _base_payload(title="Open Day", slug="open-day"), content_type="application/json")
    etag = live["ETag"]
    published = client.post(f"{url}{live.json()['id']}/publish/", {}, content_type="application/json", HTTP_IF_MATCH=etag)
    assert published.status_code == 200
    etag = published["ETag"]
    cancelled = client.post(
        f"{url}{live.json()['id']}/cancel/",
        {"notice": "Postponed for weather."},
        content_type="application/json",
        HTTP_IF_MATCH=etag,
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "CANCELLED"
    assert cancelled.json()["accepts_registration"] is False
    assert "Postponed" in cancelled.json()["cancellation_notice"]

    client.defaults.clear()
    listing = client.get("/api/v1/site-context/events/", HTTP_HOST="events-crud.uog.edu.et")
    assert listing.status_code == 200
    slugs = {row["slug"] for row in listing.json()["results"]}
    assert "open-day" in slugs
    assert "hidden-draft" not in slugs
    assert client.get("/api/v1/site-context/events/hidden-draft/", HTTP_HOST="events-crud.uog.edu.et").status_code == 404
    detail = client.get("/api/v1/site-context/events/open-day/", HTTP_HOST="events-crud.uog.edu.et")
    assert detail.status_code == 200
    assert detail.json()["cancellation_notice"]


def test_cross_site_idor_and_module_gate(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    a = Site.objects.create(code="EVT-IDOR-A", name="A", organization_unit=owner)
    b = Site.objects.create(code="EVT-IDOR-B", name="B", organization_unit=owner)
    _enable_events(a)
    _enable_events(b)
    _site_admin_client(client, oidc, a)
    created = client.post(f"/api/v1/sites/{a.pk}/events/", _base_payload(title="Private"), content_type="application/json")
    event_id = created.json()["id"]

    assert client.get(f"/api/v1/sites/{b.pk}/events/{event_id}/").status_code in (403, 404)
    assert client.patch(
        f"/api/v1/sites/{b.pk}/events/{event_id}/",
        {"title": "Stolen"},
        content_type="application/json",
        HTTP_IF_MATCH=created["ETag"],
    ).status_code in (403, 404)

    client.defaults.clear()
    _site_admin_client(client, oidc, b)
    assert client.get(f"/api/v1/sites/{a.pk}/events/{event_id}/").status_code == 403

    client.defaults.clear()
    _site_admin_client(client, oidc, a)
    disable_module_for_site(a.pk, Module.objects.get(code="EVENTS").pk)
    assert client.get(f"/api/v1/sites/{a.pk}/events/").status_code == 403
    assert Event.objects.filter(pk=event_id).exists()


def test_list_filters_duplicate_preview_and_archive(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="EVT-LIST", name="List Site", organization_unit=owner)
    _enable_events(site)
    actor = _site_admin_client(client, oidc, site)
    category = Category.objects.create(
        site=site, kind=Category.Kind.EVENTS, code="EVT_LECTURES",
        name="Lectures", slug="lectures", created_by=actor, updated_by=actor,
    )
    url = f"/api/v1/sites/{site.pk}/events/"
    first = client.post(url, _base_payload(title="Alpha Lecture", category=str(category.pk)), content_type="application/json")
    second = client.post(url, _base_payload(title="Beta Social", slug="beta-social"), content_type="application/json")
    assert first.status_code == 201 and second.status_code == 201

    listed = client.get(url, {"search": "Alpha", "category": str(category.pk)})
    assert listed.status_code == 200
    assert listed.json()["count"] == 1
    assert listed.json()["results"][0]["title"] == "Alpha Lecture"

    dup = client.post(
        f"{url}{first.json()['id']}/duplicate/", {}, content_type="application/json",
    )
    assert dup.status_code == 201
    assert dup.json()["status"] == "DRAFT"
    assert "Copy" in dup.json()["title"]

    preview = client.get(f"{url}{first.json()['id']}/preview/")
    assert preview.status_code == 200
    assert preview.json()["preview"] is True

    etag = first["ETag"]
    # Refresh etag after possible concurrent duplicate.
    detail = client.get(f"{url}{first.json()['id']}/")
    etag = detail["ETag"]
    archived = client.post(
        f"{url}{first.json()['id']}/archive/", {}, content_type="application/json", HTTP_IF_MATCH=etag,
    )
    assert archived.status_code == 200
    assert archived.json()["status"] == "ARCHIVED"
