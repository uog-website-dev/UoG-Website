"""EventSession schedule ordering, overlap, multi-day TZ, IDOR and public agenda."""
import uuid
from datetime import timedelta
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone

from apps.cms.event_models import Event, EventStatus
from apps.cms.event_session_models import EventSession, SessionStatus, SessionVisibility
from apps.media.models import MediaAsset
from apps.media.services import _media_write_session
from apps.sites.models import Module, Site, SiteDomain
from apps.sites.models.event_settings import SiteEventSettings
from apps.sites.services.lifecycle import activate_site
from apps.sites.services.modules import enable_module_for_site
from tests.test_site_appearance_api import owner, _site_admin_client  # noqa: F401

pytestmark = pytest.mark.django_db


def _enable_events(site):
    enable_module_for_site(site.pk, Module.objects.get(code="EVENTS").pk)


def _event(site, **overrides):
    start = timezone.now().replace(microsecond=0) + timedelta(days=1)
    end = start + timedelta(days=3)
    payload = {
        "site": site,
        "title": "Conference",
        "slug": f"conf-{uuid.uuid4().hex[:8]}",
        "summary": "Multi-day conference",
        "description": "<p>Schedule</p>",
        "starts_at": start,
        "ends_at": end,
        "timezone": "Africa/Addis_Ababa",
        "format": "PHYSICAL",
        "venue": "Campus",
        "status": EventStatus.DRAFT,
    }
    payload.update(overrides)
    return Event.objects.create(**payload)


def _ready_image(site, user):
    with _media_write_session(user, site.pk):
        asset = MediaAsset.objects.create(
            site=site,
            storage_reference=f"platform-private:sites/{site.pk}/logo/{uuid.uuid4()}",
            original_filename="slide.png",
            detected_mime="image/png",
            byte_count=128,
            checksum="c" * 64,
            status="PENDING",
            width=800,
            height=400,
            created_by=user,
            updated_by=user,
        )
        asset.status = "READY"
        asset.save(update_fields=("status",))
    return asset


def _session_payload(event, **overrides):
    tz = ZoneInfo(event.timezone)
    day = timezone.localtime(event.starts_at, tz).date()
    start = event.starts_at + timedelta(hours=1)
    end = start + timedelta(hours=1)
    payload = {
        "title": "Opening",
        "description": "<p>Welcome</p>",
        "session_type": "KEYNOTE",
        "venue_room": "Hall A",
        "track": "Main",
        "starts_at": start.isoformat(),
        "ends_at": end.isoformat(),
        "day_date": day.isoformat(),
        "visibility": "PUBLIC",
        "status": "SCHEDULED",
        "speaker_labels": ["Dr. Ada"],
    }
    payload.update(overrides)
    return payload


def test_session_crud_reorder_duplicate_and_concurrency(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="EVT-SESS", name="Session Site", organization_unit=owner)
    _enable_events(site)
    actor = _site_admin_client(client, oidc, site)
    event = _event(site)
    base = f"/api/v1/sites/{site.pk}/events/{event.pk}/sessions/"

    created = client.post(base, _session_payload(event), content_type="application/json")
    assert created.status_code == 201, created.content
    session_id = created.json()["id"]
    etag = created["ETag"]

    bad_order = client.post(
        base,
        _session_payload(event, title="Broken", ends_at=event.starts_at.isoformat(), starts_at=(event.starts_at + timedelta(hours=2)).isoformat()),
        content_type="application/json",
    )
    assert bad_order.status_code == 400

    out_of_range = client.post(
        base,
        _session_payload(
            event,
            title="Too late",
            starts_at=(event.ends_at + timedelta(hours=1)).isoformat(),
            ends_at=(event.ends_at + timedelta(hours=2)).isoformat(),
        ),
        content_type="application/json",
    )
    assert out_of_range.status_code == 400

    second = client.post(
        base,
        _session_payload(
            event,
            title="Workshop",
            venue_room="Hall B",
            track="Labs",
            starts_at=(event.starts_at + timedelta(hours=1)).isoformat(),
            ends_at=(event.starts_at + timedelta(hours=2)).isoformat(),
            speaker_labels=["Dr. Ada"],
        ),
        content_type="application/json",
    )
    assert second.status_code == 201, second.content
    second_id = second.json()["id"]

    listed = client.get(base)
    assert listed.status_code == 200
    assert len(listed.json()["results"]) == 2
    assert listed.json()["conflicts"]["speaker_warnings"]

    event.refresh_from_db()
    reorder = client.post(
        f"{base}reorder/",
        {"order": [second_id, session_id]},
        content_type="application/json",
        HTTP_IF_MATCH=f'"site-event-{site.pk}-{event.pk}-v{event.version}"',
    )
    assert reorder.status_code == 200, reorder.content
    assert [row["id"] for row in reorder.json()["results"]] == [second_id, session_id]
    etag = next(row for row in reorder.json()["results"] if row["id"] == session_id)
    etag = f'"site-event-session-{event.pk}-{session_id}-v{etag["version"]}"'

    dup = client.post(f"{base}{session_id}/duplicate/", {}, content_type="application/json")
    assert dup.status_code == 201
    assert "(Copy)" in dup.json()["title"]

    stale = client.patch(
        f"{base}{session_id}/",
        {"title": "Lost"},
        content_type="application/json",
        HTTP_IF_MATCH='"site-event-session-stale"',
    )
    assert stale.status_code == 412

    updated = client.patch(
        f"{base}{session_id}/",
        {"title": "Opening keynote", "status": "UPDATED"},
        content_type="application/json",
        HTTP_IF_MATCH=etag,
    )
    assert updated.status_code == 200, updated.content
    assert updated.json()["title"] == "Opening keynote"
    etag = updated["ETag"]

    removed = client.delete(f"{base}{session_id}/", HTTP_IF_MATCH=etag)
    assert removed.status_code == 200
    assert EventSession.objects.get(pk=session_id).removed_at is not None
    assert client.get(base).json()["results"]


def test_room_overlap_blocks_publish_parallel_rooms_ok(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="EVT-ROOM", name="Room Site", organization_unit=owner)
    _enable_events(site)
    SiteEventSettings.objects.update_or_create(
        site=site, defaults={"block_publish_on_session_room_conflicts": True},
    )
    actor = _site_admin_client(client, oidc, site)
    event = _event(site)
    base = f"/api/v1/sites/{site.pk}/events/{event.pk}/sessions/"
    start = event.starts_at + timedelta(hours=2)
    end = start + timedelta(hours=1)

    assert client.post(base, _session_payload(event, title="A", venue_room="Room 1", starts_at=start.isoformat(), ends_at=end.isoformat()), content_type="application/json").status_code == 201
    conflict = client.post(
        base,
        _session_payload(event, title="B", venue_room="Room 1", starts_at=start.isoformat(), ends_at=end.isoformat()),
        content_type="application/json",
    )
    assert conflict.status_code == 201
    event.refresh_from_db()
    publish = client.post(
        f"/api/v1/sites/{site.pk}/events/{event.pk}/publish/",
        {},
        content_type="application/json",
        HTTP_IF_MATCH=f'"site-event-{site.pk}-{event.pk}-v{event.version}"',
    )
    assert publish.status_code == 400
    assert "sessions" in publish.json().get("error", {}).get("details", publish.json())

    EventSession.objects.filter(event=event, title="B").update(venue_room="Room 2")
    event.refresh_from_db()
    ok = client.post(
        f"/api/v1/sites/{site.pk}/events/{event.pk}/publish/",
        {},
        content_type="application/json",
        HTTP_IF_MATCH=f'"site-event-{site.pk}-{event.pk}-v{event.version}"',
    )
    assert ok.status_code == 200, ok.content


def test_midnight_span_and_multi_day_sessions(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="EVT-MID", name="Midnight Site", organization_unit=owner)
    _enable_events(site)
    actor = _site_admin_client(client, oidc, site)
    tz = ZoneInfo("Africa/Addis_Ababa")
    start = timezone.datetime(2030, 6, 1, 8, 0, tzinfo=tz)
    end = timezone.datetime(2030, 6, 3, 18, 0, tzinfo=tz)
    event = _event(site, starts_at=start, ends_at=end, timezone="Africa/Addis_Ababa")
    base = f"/api/v1/sites/{site.pk}/events/{event.pk}/sessions/"

    night = client.post(
        base,
        _session_payload(
            event,
            title="Late panel",
            starts_at=timezone.datetime(2030, 6, 1, 23, 0, tzinfo=tz).isoformat(),
            ends_at=timezone.datetime(2030, 6, 2, 1, 0, tzinfo=tz).isoformat(),
            venue_room="Hall N",
        ),
        content_type="application/json",
    )
    assert night.status_code == 201, night.content
    assert night.json()["day_date"] == "2030-06-01"

    day2 = client.post(
        base,
        _session_payload(
            event,
            title="Day two",
            starts_at=timezone.datetime(2030, 6, 2, 10, 0, tzinfo=tz).isoformat(),
            ends_at=timezone.datetime(2030, 6, 2, 11, 0, tzinfo=tz).isoformat(),
            venue_room="Hall N",
        ),
        content_type="application/json",
    )
    assert day2.status_code == 201
    listed = client.get(base).json()["results"]
    days = {row["day_date"] for row in listed}
    assert "2030-06-01" in days and "2030-06-02" in days


def test_soft_remove_preserves_media_and_public_hides_draft(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="EVT-AGENDA", name="Public Agenda Site", organization_unit=owner)
    activate_site(site.pk)
    SiteDomain.objects.create(site=site, hostname="evt-agenda.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_events(site)
    actor = _site_admin_client(client, oidc, site)
    asset = _ready_image(site, actor)
    event = _event(site, status=EventStatus.PUBLISHED, published_at=timezone.now())
    base = f"/api/v1/sites/{site.pk}/events/{event.pk}/sessions/"

    public_row = client.post(
        base,
        _session_payload(event, title="Public talk", media_asset=str(asset.pk)),
        content_type="application/json",
    )
    assert public_row.status_code == 201, public_row.content
    hidden = client.post(
        base,
        _session_payload(
            event,
            title="Staff only",
            visibility="HIDDEN",
            starts_at=(event.starts_at + timedelta(hours=3)).isoformat(),
            ends_at=(event.starts_at + timedelta(hours=4)).isoformat(),
            venue_room="Hall C",
        ),
        content_type="application/json",
    )
    assert hidden.status_code == 201
    cancelled = client.post(
        base,
        _session_payload(
            event,
            title="Cancelled talk",
            status="CANCELLED",
            starts_at=(event.starts_at + timedelta(hours=5)).isoformat(),
            ends_at=(event.starts_at + timedelta(hours=6)).isoformat(),
            venue_room="Hall D",
        ),
        content_type="application/json",
    )
    assert cancelled.status_code == 201
    session_id = public_row.json()["id"]
    etag = public_row["ETag"]

    deleted = client.delete(f"{base}{session_id}/", HTTP_IF_MATCH=etag)
    assert deleted.status_code == 200
    assert MediaAsset.objects.filter(pk=asset.pk).exists()
    assert EventSession.objects.filter(pk=session_id).exists()

    client.defaults.clear()
    agenda = client.get(
        f"/api/v1/site-context/events/{event.slug}/agenda/",
        HTTP_HOST="evt-agenda.uog.edu.et",
    )
    assert agenda.status_code == 200, agenda.content
    titles = [
        session["title"]
        for day in agenda.json()["days"]
        for track in day["tracks"]
        for session in track["sessions"]
    ]
    assert "Staff only" not in titles
    assert "Public talk" not in titles  # soft-removed
    assert "Cancelled talk" in titles

    settings_row, _ = SiteEventSettings.objects.get_or_create(site=site)
    SiteEventSettings.objects.filter(pk=settings_row.pk).update(hide_cancelled_sessions_publicly=True)
    assert SiteEventSettings.objects.get(site=site).hide_cancelled_sessions_publicly is True
    hidden_cancelled = client.get(
        f"/api/v1/site-context/events/{event.slug}/agenda/",
        HTTP_HOST="evt-agenda.uog.edu.et",
    )
    titles = [
        session["title"]
        for day in hidden_cancelled.json()["days"]
        for track in day["tracks"]
        for session in track["sessions"]
    ]
    assert "Cancelled talk" not in titles


def test_cross_site_session_idor(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site_a = Site.objects.create(code="EVT-A", name="Site A", organization_unit=owner)
    site_b = Site.objects.create(code="EVT-B", name="Site B", organization_unit=owner)
    _enable_events(site_a)
    _enable_events(site_b)
    actor_a = _site_admin_client(client, oidc, site_a)
    event_a = _event(site_a)
    event_b = _event(site_b)
    created = client.post(
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/sessions/",
        _session_payload(event_a),
        content_type="application/json",
    )
    assert created.status_code == 201
    session_id = created.json()["id"]

    actor_b = _site_admin_client(client, oidc, site_b)
    denied = client.get(f"/api/v1/sites/{site_b.pk}/events/{event_a.pk}/sessions/{session_id}/")
    assert denied.status_code == 404
    cross = client.patch(
        f"/api/v1/sites/{site_b.pk}/events/{event_b.pk}/sessions/{session_id}/",
        {"title": "Hijack"},
        content_type="application/json",
        HTTP_IF_MATCH=created["ETag"],
    )
    assert cross.status_code == 404
    assert EventSession.objects.get(pk=session_id).title == "Opening"
