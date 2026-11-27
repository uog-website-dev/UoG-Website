"""Event updates: CRUD, XSS, IDOR, session revision, cache freshness."""
from datetime import timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone

from apps.cms.event_models import Event, EventStatus
from apps.cms.event_update_models import EventSessionRevision, EventUpdate, UpdateStatus
from apps.sites.models import Module, Site, SiteDomain
from apps.sites.services.lifecycle import activate_site
from apps.sites.services.modules import enable_module_for_site
from tests.test_site_appearance_api import owner, _site_admin_client  # noqa: F401

pytestmark = pytest.mark.django_db


def _enable_events(site):
    enable_module_for_site(site.pk, Module.objects.get(code="EVENTS").pk)


def _event(site, **overrides):
    start = timezone.now().replace(microsecond=0) + timedelta(days=1)
    payload = {
        "site": site,
        "title": "Updates Summit",
        "slug": f"updates-{uuid4().hex[:8]}",
        "summary": "Notices",
        "description": "<p>Notices</p>",
        "status": EventStatus.PUBLISHED,
        "published_at": timezone.now(),
        "starts_at": start,
        "ends_at": start + timedelta(days=2),
        "timezone": "Africa/Addis_Ababa",
        "venue": "Hall",
    }
    payload.update(overrides)
    return Event.objects.create(**payload)


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


def test_update_crud_publish_order_xss_and_cache(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="EVT-UPD", name="Updates Site", organization_unit=owner)
    activate_site(site.pk)
    SiteDomain.objects.create(site=site, hostname="evt-upd.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_events(site)
    actor = _site_admin_client(client, oidc, site)
    event = _event(site)
    root_version = event.version
    base = f"/api/v1/sites/{site.pk}/events/{event.pk}/updates/"

    draft = client.post(
        base,
        {
            "title": "Room change",
            "body": '<p>Moved to Hall B</p><script>alert(1)</script>',
            "severity": "IMPORTANT",
            "pinned": True,
        },
        content_type="application/json",
    )
    assert draft.status_code == 201, draft.content
    body = draft.json()
    assert body["status"] == "DRAFT"
    assert "<script" not in body["body"].lower()
    assert "Hall B" in body["body"]
    update_id = body["id"]
    version = body["version"]

    info = client.post(
        base,
        {"title": "Parking tip", "body": "<p>Lot C</p>", "severity": "INFO", "pinned": False},
        content_type="application/json",
    )
    assert info.status_code == 201
    info_id = info.json()["id"]

    # Drafts never appear on public feeds.
    public_empty = client.get(
        f"/api/v1/site-context/events/{event.slug}/updates/",
        HTTP_HOST="evt-upd.uog.edu.et",
    )
    assert public_empty.status_code == 200
    assert public_empty.json() == []
    assert "max-age=30" in public_empty["Cache-Control"]
    assert public_empty["X-Events-Cache-Freshness-Seconds"] == "30"

    detail = client.get(f"/api/v1/site-context/events/{event.slug}/", HTTP_HOST="evt-upd.uog.edu.et")
    assert detail.status_code == 200
    assert detail.json()["sections"]["updates"] is False
    assert detail.json().get("notices") == []

    published = client.post(
        f"{base}{update_id}/action/",
        {"action": "publish", "version": version},
        content_type="application/json",
    )
    assert published.status_code == 200, published.content
    assert published.json()["status"] == "PUBLISHED"
    assert Event.objects.get(pk=event.pk).version == root_version

    client.post(
        f"{base}{info_id}/action/",
        {"action": "publish", "version": info.json()["version"]},
        content_type="application/json",
    )

    listed = client.get(
        f"/api/v1/site-context/events/{event.slug}/updates/",
        HTTP_HOST="evt-upd.uog.edu.et",
    )
    assert listed.status_code == 200
    rows = listed.json()
    assert len(rows) == 2
    assert rows[0]["id"] == update_id  # pinned first
    assert rows[0]["title"] == "Room change"
    assert "status" not in rows[0]
    assert "created_by" not in rows[0]
    assert "event" not in rows[0]
    assert "<script" not in rows[0]["body"].lower()
    assert listed["ETag"]
    assert listed["X-Events-Cache-Section"] == "updates"

    detail_after = client.get(f"/api/v1/site-context/events/{event.slug}/", HTTP_HOST="evt-upd.uog.edu.et")
    assert detail_after.json()["sections"]["updates"] is True
    notices = detail_after.json()["notices"]
    assert len(notices) == 1
    assert notices[0]["id"] == update_id
    assert notices[0]["severity"] == "IMPORTANT"

    notices_api = client.get(
        f"/api/v1/site-context/events/{event.slug}/notices/",
        HTTP_HOST="evt-upd.uog.edu.et",
    )
    assert notices_api.status_code == 200
    assert [row["id"] for row in notices_api.json()] == [update_id]

    unpublished = client.post(
        f"{base}{update_id}/action/",
        {"action": "unpublish", "version": published.json()["version"]},
        content_type="application/json",
    )
    assert unpublished.status_code == 200
    assert unpublished.json()["status"] == "UNPUBLISHED"
    assert Event.objects.get(pk=event.pk).version == root_version

    after_unpub = client.get(
        f"/api/v1/site-context/events/{event.slug}/updates/",
        HTTP_HOST="evt-upd.uog.edu.et",
    )
    assert [row["id"] for row in after_unpub.json()] == [info_id]


def test_session_revision_and_invalid_schedule_change(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="EVT-UREV", name="Update Rev Site", organization_unit=owner)
    activate_site(site.pk)
    SiteDomain.objects.create(site=site, hostname="evt-urev.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_events(site)
    actor = _site_admin_client(client, oidc, site)
    event = _event(site)
    sessions = f"/api/v1/sites/{site.pk}/events/{event.pk}/sessions/"

    created = client.post(sessions, _session_payload(event), content_type="application/json")
    assert created.status_code == 201, created.content
    session_id = created.json()["id"]
    etag = created["ETag"]

    invalid = client.patch(
        f"{sessions}{session_id}/",
        {
            "starts_at": (event.ends_at + timedelta(hours=1)).isoformat(),
            "ends_at": (event.ends_at + timedelta(hours=2)).isoformat(),
        },
        content_type="application/json",
        HTTP_IF_MATCH=etag,
    )
    assert invalid.status_code == 400
    assert EventSessionRevision.objects.filter(session_id=session_id).count() == 0

    new_room = "Hall C"
    new_start = event.starts_at + timedelta(hours=2)
    new_end = new_start + timedelta(hours=1)
    updated = client.patch(
        f"{sessions}{session_id}/",
        {
            "venue_room": new_room,
            "starts_at": new_start.isoformat(),
            "ends_at": new_end.isoformat(),
            "status": "UPDATED",
        },
        content_type="application/json",
        HTTP_IF_MATCH=etag,
    )
    assert updated.status_code == 200, updated.content
    assert updated.json()["venue_room"] == new_room

    revisions = client.get(
        f"/api/v1/sites/{site.pk}/events/{event.pk}/sessions/{session_id}/revisions/",
    )
    assert revisions.status_code == 200
    history = revisions.json()
    assert len(history) >= 1
    assert history[0]["actor"] == actor.pk
    assert "venue_room" in history[0]["changed_fields"]
    assert history[0]["after"]["venue_room"] == new_room

    agenda = client.get(
        f"/api/v1/site-context/events/{event.slug}/agenda/",
        HTTP_HOST="evt-urev.uog.edu.et",
    )
    assert agenda.status_code == 200
    flat = [
        session
        for day in agenda.json()["days"]
        for track in day["tracks"]
        for session in track["sessions"]
    ]
    match = next(row for row in flat if row["id"] == session_id)
    assert match["venue_room"] == new_room
    assert "must-revalidate" in agenda["Cache-Control"]


def test_cross_site_update_authorization(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site_a = Site.objects.create(code="EVT-UA", name="Upd A", organization_unit=owner)
    site_b = Site.objects.create(code="EVT-UB", name="Upd B", organization_unit=owner)
    activate_site(site_a.pk)
    activate_site(site_b.pk)
    SiteDomain.objects.create(site=site_a, hostname="evt-ua.uog.edu.et", is_primary=True, status="ACTIVE")
    SiteDomain.objects.create(site=site_b, hostname="evt-ub.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_events(site_a)
    _enable_events(site_b)
    actor_a = _site_admin_client(client, oidc, site_a)
    event_a = _event(site_a, slug="summit-a")
    event_b = _event(site_b, slug="summit-b")
    base_a = f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/updates/"
    created = client.post(
        base_a,
        {"title": "A only", "body": "<p>Private draft</p>", "severity": "URGENT", "pinned": True},
        content_type="application/json",
    )
    assert created.status_code == 201, created.content
    update_id = created.json()["id"]
    client.post(
        f"{base_a}{update_id}/action/",
        {"action": "publish", "version": created.json()["version"]},
        content_type="application/json",
    )

    _site_admin_client(client, oidc, site_b)
    denied_list = client.get(f"/api/v1/sites/{site_b.pk}/events/{event_a.pk}/updates/")
    assert denied_list.status_code in {403, 404}
    denied_create = client.post(
        f"/api/v1/sites/{site_b.pk}/events/{event_a.pk}/updates/",
        {"title": "Hijack", "body": "<p>nope</p>"},
        content_type="application/json",
    )
    assert denied_create.status_code in {403, 404}
    denied_action = client.post(
        f"/api/v1/sites/{site_b.pk}/events/{event_a.pk}/updates/{update_id}/action/",
        {"action": "unpublish"},
        content_type="application/json",
    )
    assert denied_action.status_code in {403, 404}

    # Wrong host must not expose Site A's published update.
    foreign_host = client.get(
        f"/api/v1/site-context/events/{event_a.slug}/updates/",
        HTTP_HOST="evt-ub.uog.edu.et",
    )
    assert foreign_host.status_code == 404

    own = client.get(
        f"/api/v1/site-context/events/{event_a.slug}/updates/",
        HTTP_HOST="evt-ua.uog.edu.et",
    )
    assert own.status_code == 200
    assert len(own.json()) == 1
    assert EventUpdate.objects.filter(pk=update_id, status=UpdateStatus.PUBLISHED).exists()
