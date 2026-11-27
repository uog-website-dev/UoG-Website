"""P0-EVENT-014 Site-scoped RBAC / IDOR / privacy / module / rate-limit matrix."""
from datetime import timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from django.core.cache import cache
from django.utils import timezone

from apps.audit.models import AuditEvent
from apps.cms.event_models import Event, EventStatus
from apps.cms.event_person_models import EventPerson
from apps.cms.event_registration_models import EventRegistration, RegistrationStatus
from apps.cms.event_session_models import EventSession, SessionStatus, SessionVisibility
from apps.cms.event_update_domain import create_update, set_update_status
from apps.sites.models import Module, Site, SiteDomain
from apps.sites.services.lifecycle import activate_site
from apps.sites.services.modules import disable_module_for_site, enable_module_for_site
from tests.test_site_appearance_api import owner, _site_admin_client  # noqa: F401

pytestmark = pytest.mark.django_db


def _enable_events(site):
    enable_module_for_site(site.pk, Module.objects.get(code="EVENTS").pk)


def _pair(owner):
    site_a = Site.objects.create(code="EVT-SEC-A", name="Sec A", organization_unit=owner)
    site_b = Site.objects.create(code="EVT-SEC-B", name="Sec B", organization_unit=owner)
    activate_site(site_a.pk)
    activate_site(site_b.pk)
    SiteDomain.objects.create(site=site_a, hostname="evt-seca.uog.edu.et", is_primary=True, status="ACTIVE")
    SiteDomain.objects.create(site=site_b, hostname="evt-secb.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_events(site_a)
    _enable_events(site_b)
    return site_a, site_b


def _event(site, **overrides):
    start = timezone.now() + timedelta(days=2)
    payload = {
        "site": site,
        "title": "Security Summit",
        "slug": f"sec-{uuid4().hex[:8]}",
        "summary": "Private planning",
        "description": "<p>Agenda</p>",
        "status": EventStatus.PUBLISHED,
        "published_at": timezone.now(),
        "starts_at": start,
        "ends_at": start + timedelta(hours=4),
        "timezone": "Africa/Addis_Ababa",
        "venue": "Hall",
        "organizer_email": "private-org@example.com",
        "organizer_phone": "+251911000000",
        "registration_required": True,
        "registration_open": True,
        "registration_capacity": 50,
        "registration_required_fields": ["participant_name", "email"],
    }
    payload.update(overrides)
    return Event.objects.create(**payload)


def _session(event, **overrides):
    start = event.starts_at + timedelta(hours=1)
    tz = ZoneInfo(event.timezone or "Africa/Addis_Ababa")
    payload = {
        "event": event,
        "title": "Keynote",
        "starts_at": start,
        "ends_at": start + timedelta(hours=1),
        "day_date": timezone.localtime(start, tz).date(),
        "status": SessionStatus.SCHEDULED,
        "visibility": SessionVisibility.PUBLIC,
        "sort_order": 0,
    }
    payload.update(overrides)
    return EventSession.objects.create(**payload)


def _person(event, **overrides):
    payload = {
        "event": event,
        "display_name": "Ada Lovelace",
        "affiliation": "UoG",
        "biography": "<p>Speaker</p>",
        "private_email": "ada-private@example.com",
        "private_phone": "+251900000001",
        "visibility": "PUBLIC",
        "sort_order": 0,
    }
    payload.update(overrides)
    return EventPerson.objects.create(**payload)


def _participant(event, **overrides):
    payload = {
        "event": event,
        "site": event.site,
        "request_id": uuid4(),
        "email": "attendee@example.com",
        "email_normalized": "attendee@example.com",
        "participant_name": "Attendee One",
        "organization": "College",
        "phone": "+251900000002",
        "status": RegistrationStatus.CONFIRMED,
        "consent_at": timezone.now(),
        "confirmed_at": timezone.now(),
    }
    payload.update(overrides)
    return EventRegistration.objects.create(**payload)


def test_rbac_matrix_and_cross_site_idor(client, oidc, owner, settings):
    """Site Admin of A cannot read/mutate private Event data of B by guessing IDs."""
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site_a, site_b = _pair(owner)
    event_a = _event(site_a, slug="summit-a")
    event_b = _event(site_b, slug="summit-b", title="Other College Summit")
    session_a = _session(event_a)
    session_b = _session(event_b, title="Foreign Session")
    person_a = _person(event_a)
    person_b = _person(event_b, display_name="Foreign Speaker", private_email="x@b.example")
    reg_a = _participant(event_a)
    reg_b = _participant(event_b, email="b@example.com", email_normalized="b@example.com")

    actor_a = _site_admin_client(client, oidc, site_a)

    # Own Site works.
    assert client.get(f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/").status_code == 200
    assert client.get(
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/sessions/{session_a.pk}/",
    ).status_code == 200

    # Cross-Site Event ID under foreign Site path.
    assert client.get(f"/api/v1/sites/{site_a.pk}/events/{event_b.pk}/").status_code == 404
    assert client.get(
        f"/api/v1/sites/{site_a.pk}/events/{event_b.pk}/registrations/",
    ).status_code == 404
    assert client.get(
        f"/api/v1/sites/{site_a.pk}/events/{event_b.pk}/attendance/",
    ).status_code == 404
    assert client.get(
        f"/api/v1/sites/{site_a.pk}/events/{event_b.pk}/report/export/",
    ).status_code == 404

    # Nested parent-child substitution: foreign child under own Event.
    assert client.get(
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/sessions/{session_b.pk}/",
    ).status_code == 404
    assert client.get(
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/people/{person_b.pk}/",
    ).status_code == 404
    assert client.get(
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/registrations/{reg_b.pk}/",
    ).status_code == 404

    # Site B admin cannot reach Site A private records.
    _site_admin_client(client, oidc, site_b)
    for path in (
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/",
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/sessions/{session_a.pk}/",
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/people/{person_a.pk}/",
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/registrations/{reg_a.pk}/",
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/registrations/export/",
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/report/export/",
        f"/api/v1/sites/{site_b.pk}/events/{event_a.pk}/sessions/",
        f"/api/v1/sites/{site_b.pk}/events/{event_b.pk}/sessions/{session_a.pk}/",
        f"/api/v1/sites/{site_b.pk}/events/{event_b.pk}/people/{person_a.pk}/",
        f"/api/v1/sites/{site_b.pk}/events/{event_b.pk}/registrations/{reg_a.pk}/",
    ):
        assert client.get(path).status_code in {403, 404}, path

    # Query filter with foreign Site Event ID must not leak.
    listed = client.get(f"/api/v1/sites/{site_b.pk}/events/", {"search": "College"})
    assert listed.status_code == 200
    ids = {row["id"] for row in listed.json()["results"]}
    assert str(event_a.pk) not in ids
    assert str(event_b.pk) in ids

    # Unauthenticated export is rejected (authorization is not UI-only).
    client.defaults.clear()
    client.logout()
    assert client.get(
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/registrations/export/",
    ).status_code in {401, 403}
    assert actor_a is not None


def test_public_payloads_hide_pii_and_drafts(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site_a, site_b = _pair(owner)
    event = _event(site_a, slug="public-sec")
    draft = _event(site_a, slug="draft-sec", status=EventStatus.DRAFT, published_at=None)
    _person(event)
    _participant(event, email="secret@example.com", email_normalized="secret@example.com")
    private = _event(site_b, slug="public-sec", title="Foreign private")

    detail = client.get(
        "/api/v1/site-context/events/public-sec/",
        HTTP_HOST="evt-seca.uog.edu.et",
    )
    assert detail.status_code == 200
    body = detail.content.decode("utf-8", errors="ignore")
    assert "private-org@" not in body
    assert "+251911" not in body
    assert "secret@" not in body
    assert "attendee@" not in body
    assert "ada-private@" not in body
    assert "Foreign private" not in body

    speakers = client.get(
        "/api/v1/site-context/events/public-sec/speakers/",
        HTTP_HOST="evt-seca.uog.edu.et",
    )
    assert speakers.status_code == 200
    speaker_body = speakers.content.decode("utf-8", errors="ignore")
    assert "ada-private@" not in speaker_body
    assert "+251900000001" not in speaker_body

    assert client.get(
        "/api/v1/site-context/events/draft-sec/",
        HTTP_HOST="evt-seca.uog.edu.et",
    ).status_code == 404
    assert draft.status == EventStatus.DRAFT
    assert private.site_id == site_b.pk


def test_module_disablement_blocks_writes_and_public(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site_a, _site_b = _pair(owner)
    event = _event(site_a, slug="mod-gate")
    _site_admin_client(client, oidc, site_a)
    disable_module_for_site(site_a.pk, Module.objects.get(code="EVENTS").pk)

    assert client.get(f"/api/v1/sites/{site_a.pk}/events/").status_code == 403
    assert client.post(
        f"/api/v1/sites/{site_a.pk}/events/{event.pk}/registrations/",
        {
            "participant_name": "X",
            "email": "x@example.com",
            "mode": "invite",
            "request_id": str(uuid4()),
        },
        content_type="application/json",
    ).status_code == 403
    assert client.get(
        "/api/v1/site-context/events/mod-gate/",
        HTTP_HOST="evt-seca.uog.edu.et",
    ).status_code == 404
    assert Event.objects.filter(pk=event.pk).exists()


def test_registration_rate_limit_and_export_audit(client, oidc, owner, settings, monkeypatch):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site_a, _site_b = _pair(owner)
    event = _event(site_a, slug="rate-sec")
    cache.clear()

    from apps.cms.api.event_registrations import RegistrationThrottle

    monkeypatch.setattr(RegistrationThrottle, "rate", "1/min")

    host = "evt-seca.uog.edu.et"
    first = client.post(
        f"/api/v1/site-context/events/{event.slug}/registrations/",
        {
            "request_id": str(uuid4()),
            "participant_name": "One",
            "email": "one@example.com",
            "website": "",
            "consent": True,
        },
        content_type="application/json",
        HTTP_HOST=host,
        HTTP_ORIGIN=f"http://{host}",
        REMOTE_ADDR="203.0.113.10",
    )
    assert first.status_code in {201, 202}, first.content
    second = client.post(
        f"/api/v1/site-context/events/{event.slug}/registrations/",
        {
            "request_id": str(uuid4()),
            "participant_name": "Two",
            "email": "two@example.com",
            "website": "",
            "consent": True,
        },
        content_type="application/json",
        HTTP_HOST=host,
        HTTP_ORIGIN=f"http://{host}",
        REMOTE_ADDR="203.0.113.10",
    )
    assert second.status_code == 429

    actor = _site_admin_client(client, oidc, site_a)
    export = client.get(f"/api/v1/sites/{site_a.pk}/events/{event.pk}/registrations/export/")
    assert export.status_code == 200
    csv_text = export.content.decode("utf-8")
    assert "one@example.com" in csv_text
    assert "phone" not in csv_text.splitlines()[0].lower()
    audit = AuditEvent.objects.filter(action="EVENT_PARTICIPANT_CSV_EXPORTED").order_by("-id").first()
    assert audit is not None
    assert audit.actor_id
    assert audit.after.get("site") == site_a.pk
    assert actor.pk


def test_update_xss_sanitized_and_draft_notice_hidden(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site_a, _site_b = _pair(owner)
    event = _event(site_a, slug="xss-sec")
    actor = _site_admin_client(client, oidc, site_a)
    draft = create_update(
        event,
        {"title": "Draft", "body": '<p>Hi</p><script>alert(1)</script>', "severity": "INFO"},
        actor=actor,
    )
    assert "<script" not in draft.body.lower()
    public = client.get(
        f"/api/v1/site-context/events/{event.slug}/updates/",
        HTTP_HOST="evt-seca.uog.edu.et",
    )
    assert public.status_code == 200
    assert public.json() == []
    set_update_status(event, draft.pk, action="publish", actor=actor)
    published = client.get(
        f"/api/v1/site-context/events/{event.slug}/updates/",
        HTTP_HOST="evt-seca.uog.edu.et",
    )
    assert published.status_code == 200
    rows = published.json()
    assert len(rows) == 1
    assert "<script" not in rows[0]["body"].lower()
