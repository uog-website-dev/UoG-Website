"""Public Event detail, section flags, speakers cache scope and cross-Site 404."""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.cms.event_models import Event, EventStatus
from apps.cms.event_person_models import EventPerson, SessionPerson, SessionPersonRole
from apps.cms.event_session_models import EventSession, SessionStatus, SessionType, SessionVisibility
from apps.sites.models import Module, Site, SiteDomain
from apps.sites.services.lifecycle import activate_site
from apps.sites.services.modules import enable_module_for_site
from tests.test_site_appearance_api import owner, _site_admin_client  # noqa: F401

pytestmark = pytest.mark.django_db


def _enable_events(site):
    enable_module_for_site(site.pk, Module.objects.get(code="EVENTS").pk)


def _published_event(site, **overrides):
    start = timezone.now() + timedelta(days=3)
    payload = {
        "site": site,
        "title": "Research Symposium",
        "slug": "research-symposium",
        "summary": "Campus research day",
        "description": "<p>Open sessions across tracks.</p>",
        "status": EventStatus.PUBLISHED,
        "published_at": timezone.now(),
        "starts_at": start,
        "ends_at": start + timedelta(days=1, hours=6),
        "timezone": "Africa/Addis_Ababa",
        "venue": "Innovation Hall",
        "organizer_name": "Research Office",
        "organizer_email": "private@example.com",
        "organizer_phone": "+251111",
        "registration_required": True,
        "registration_open": True,
    }
    payload.update(overrides)
    return Event.objects.create(**payload)


def test_public_detail_sections_speakers_and_private_fields(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="EVT-DET", name="Detail Site", organization_unit=owner)
    activate_site(site.pk)
    SiteDomain.objects.create(site=site, hostname="evt-detail.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_events(site)
    event = _published_event(site)
    day = event.starts_at.date()
    session = EventSession.objects.create(
        event=event,
        day_date=day,
        starts_at=event.starts_at,
        ends_at=event.starts_at + timedelta(hours=1),
        title="Opening keynote",
        description="<p>Welcome</p>",
        session_type=SessionType.KEYNOTE,
        venue_room="Hall A",
        track="Main",
        visibility=SessionVisibility.PUBLIC,
        status=SessionStatus.SCHEDULED,
        sort_order=0,
    )
    EventSession.objects.create(
        event=event,
        day_date=day,
        starts_at=event.starts_at + timedelta(hours=2),
        ends_at=event.starts_at + timedelta(hours=3),
        title="Staff only briefing",
        visibility=SessionVisibility.HIDDEN,
        status=SessionStatus.SCHEDULED,
        sort_order=1,
    )
    public_person = EventPerson.objects.create(
        event=event,
        display_name="Dr Public",
        affiliation="UoG",
        private_email="speaker-secret@example.com",
        visibility=SessionVisibility.PUBLIC,
        sort_order=0,
    )
    EventPerson.objects.create(
        event=event,
        display_name="Hidden Host",
        private_email="hidden@example.com",
        visibility=SessionVisibility.HIDDEN,
        sort_order=1,
    )
    SessionPerson.objects.create(
        session=session,
        person=public_person,
        role=SessionPersonRole.SPEAKER,
        sort_order=0,
    )

    detail = client.get(
        f"/api/v1/site-context/events/{event.slug}/",
        HTTP_HOST="evt-detail.uog.edu.et",
    )
    assert detail.status_code == 200, detail.content
    body = detail.json()
    assert body["title"] == "Research Symposium"
    assert body["venue"] == "Innovation Hall"
    assert body["timezone"] == "Africa/Addis_Ababa"
    assert body["contact_name"] == "Research Office"
    assert body["sections"]["overview"] is True
    assert body["sections"]["schedule"] is True
    assert body["sections"]["speakers"] is True
    assert body["sections"]["gallery"] is False
    assert body["sections"]["resources"] is False
    assert body["sections"]["updates"] is False
    assert "organizer_email" not in body
    assert "organizer_phone" not in body
    assert "private@" not in str(body)
    assert detail["X-Events-Cache-Section"] == "detail"
    assert f"site-{site.pk}-event-{event.slug}" in detail["X-Events-Cache-Scope"]
    assert body["banner_url"] is None or body["banner_url"].startswith("/api/v1/site-context/media/")

    speakers = client.get(
        f"/api/v1/site-context/events/{event.slug}/speakers/",
        HTTP_HOST="evt-detail.uog.edu.et",
    )
    assert speakers.status_code == 200, speakers.content
    assert speakers["X-Events-Cache-Section"] == "speakers"
    assert f"-speakers" in speakers["X-Events-Cache-Scope"]
    names = {row["display_name"] for row in speakers.json()["results"]}
    assert names == {"Dr Public"}
    assert "speaker-secret@" not in str(speakers.json())
    assert speakers.json()["results"][0]["roles"][0]["session_title"] == "Opening keynote"

    agenda = client.get(
        f"/api/v1/site-context/events/{event.slug}/agenda/",
        HTTP_HOST="evt-detail.uog.edu.et",
    )
    assert agenda.status_code == 200
    assert agenda["X-Events-Cache-Section"] == "agenda"
    titles = [
        session_row["title"]
        for day in agenda.json()["days"]
        for track in day["tracks"]
        for session_row in track["sessions"]
    ]
    assert titles == ["Opening keynote"]

    # Child section changes do not require Event republish: add another public speaker.
    EventPerson.objects.create(
        event=event,
        display_name="New Moderator",
        visibility=SessionVisibility.PUBLIC,
        sort_order=2,
    )
    refreshed = client.get(
        f"/api/v1/site-context/events/{event.slug}/speakers/",
        HTTP_HOST="evt-detail.uog.edu.et",
    )
    assert {row["display_name"] for row in refreshed.json()["results"]} == {"Dr Public", "New Moderator"}
    assert Event.objects.get(pk=event.pk).version == event.version


def test_cancelled_event_disables_registration_and_draft_is_404(client, oidc, owner, settings):
    settings.DEBUG = True
    site = Site.objects.create(code="EVT-CAN", name="Cancel Site", organization_unit=owner)
    activate_site(site.pk)
    SiteDomain.objects.create(site=site, hostname="evt-cancel.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_events(site)
    live = _published_event(
        site,
        slug="live-day",
        status=EventStatus.CANCELLED,
        cancelled_at=timezone.now(),
        cancellation_notice="Moved to next term.",
        registration_open=False,
    )
    Event.objects.create(
        site=site,
        title="Draft only",
        slug="draft-only",
        status=EventStatus.DRAFT,
        starts_at=timezone.now() + timedelta(days=1),
        ends_at=timezone.now() + timedelta(days=1, hours=2),
        timezone="Africa/Addis_Ababa",
        organizer_email="draft@example.com",
    )

    detail = client.get("/api/v1/site-context/events/live-day/", HTTP_HOST="evt-cancel.uog.edu.et")
    assert detail.status_code == 200
    assert detail.json()["status"] == "CANCELLED"
    assert detail.json()["accepts_registration"] is False
    assert "Moved to next term" in detail.json()["cancellation_notice"]

    missing = client.get("/api/v1/site-context/events/draft-only/", HTTP_HOST="evt-cancel.uog.edu.et")
    assert missing.status_code == 404
    assert "draft@" not in missing.content.decode("utf-8", errors="ignore")
    assert "Draft only" not in missing.content.decode("utf-8", errors="ignore")


def test_foreign_site_private_event_is_unavailable(client, oidc, owner, settings):
    settings.DEBUG = True
    a = Site.objects.create(code="EVT-A", name="College A", organization_unit=owner)
    b = Site.objects.create(code="EVT-B", name="College B", organization_unit=owner)
    activate_site(a.pk)
    activate_site(b.pk)
    SiteDomain.objects.create(site=a, hostname="college-a.uog.edu.et", is_primary=True, status="ACTIVE")
    SiteDomain.objects.create(site=b, hostname="college-b.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_events(a)
    _enable_events(b)
    event = _published_event(a, slug="college-a-only")

    assert client.get(
        f"/api/v1/site-context/events/{event.slug}/",
        HTTP_HOST="college-a.uog.edu.et",
    ).status_code == 200
    foreign = client.get(
        f"/api/v1/site-context/events/{event.slug}/",
        HTTP_HOST="college-b.uog.edu.et",
    )
    assert foreign.status_code == 404
    assert "Research Office" not in foreign.content.decode("utf-8", errors="ignore")
    assert "private@" not in foreign.content.decode("utf-8", errors="ignore")
