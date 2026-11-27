"""Participant admin: invite/CRUD, badges, CSV injection, IDOR, capacity."""
from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone

from apps.audit.models import AuditEvent
from apps.cms.event_models import Event, EventStatus
from apps.cms.event_registration_models import EventRegistration, RegistrationStatus
from apps.sites.models import Module, Site, SiteDomain
from apps.sites.services.lifecycle import activate_site
from apps.sites.services.modules import enable_module_for_site
from tests.test_site_appearance_api import owner, _site_admin_client  # noqa: F401

pytestmark = pytest.mark.django_db


def _enable_events(site):
    enable_module_for_site(site.pk, Module.objects.get(code="EVENTS").pk)


def _event(site, **overrides):
    start = timezone.now() + timedelta(days=2)
    payload = {
        "site": site,
        "title": "Participant Summit",
        "slug": "participant-summit",
        "summary": "Invite-only summit",
        "description": "<p>Welcome</p>",
        "status": EventStatus.PUBLISHED,
        "published_at": timezone.now(),
        "starts_at": start,
        "ends_at": start + timedelta(hours=3),
        "timezone": "Africa/Addis_Ababa",
        "venue": "Hall",
        "registration_required": True,
        "registration_open": True,
        "registration_capacity": 2,
        "waitlist_enabled": True,
        "registration_required_fields": ["participant_name", "email"],
    }
    payload.update(overrides)
    return Event.objects.create(**payload)


def test_admin_invite_confirm_category_badge_csv_and_capacity(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="EVT-PART", name="Participant Site", organization_unit=owner)
    activate_site(site.pk)
    SiteDomain.objects.create(site=site, hostname="evt-part.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_events(site)
    _site_admin_client(client, oidc, site)
    event = _event(site)
    base = f"/api/v1/sites/{site.pk}/events/{event.pk}/registrations/"

    invite = client.post(
        base,
        {
            "participant_name": "=Alice",
            "email": "alice@example.com",
            "organization": "+Org",
            "display_category": "VIP",
            "mode": "invite",
            "request_id": str(uuid4()),
        },
        content_type="application/json",
    )
    assert invite.status_code == 201, invite.content
    body = invite.json()
    assert body["status"] == "INVITED"
    assert body["display_category"] == "VIP"
    assert body["source"] == "ADMIN_INVITE"
    assert body["check_in_token"]
    participant_id = body["id"]
    check_in = body["check_in_token"]

    listed = client.get(f"{base}?status=INVITED&category=VIP&search=Alice")
    assert listed.status_code == 200
    assert listed.json()["count"] == 1
    assert listed.json()["summary"]["invited"] == 1
    assert listed.json()["summary"]["confirmed"] == 1  # INVITED holds a seat
    assert listed.json()["summary"]["seats_remaining"] == 1

    category = client.patch(
        f"{base}{participant_id}/",
        {"display_category": "SPEAKER"},
        content_type="application/json",
    )
    assert category.status_code == 200
    assert category.json()["display_category"] == "SPEAKER"
    # Session speaker roles are separate — no EventPerson created by category change.
    assert event.people.count() == 0

    confirmed = client.post(
        f"{base}{participant_id}/",
        {"action": "confirm"},
        content_type="application/json",
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["status"] == "CONFIRMED"
    assert listed.json()["summary"]["seats_remaining"] == 1
    after = client.get(base).json()["summary"]
    assert after["confirmed"] == 1
    assert after["seats_remaining"] == 1

    badge_a = client.get(f"{base}{participant_id}/badge/")
    badge_b = client.get(f"{base}{participant_id}/badge/")
    assert badge_a.status_code == 200
    assert badge_a.json()["event_title"] == event.title
    assert badge_a.json()["participant_name"] == "=Alice"
    assert badge_a.json()["display_category"] == "SPEAKER"
    assert badge_a.json()["check_in_token"] == check_in
    assert badge_b.json()["check_in_token"] == check_in
    assert "email" not in badge_a.json()
    assert "phone" not in badge_a.json()
    assert EventRegistration.objects.filter(event=event).count() == 1

    exported = client.get(f"{base}export/")
    assert exported.status_code == 200
    assert exported["Content-Type"].startswith("text/csv")
    csv_text = exported.content.decode("utf-8-sig")
    assert "'=Alice" in csv_text
    assert "'+Org" in csv_text
    assert "alice@example.com" in csv_text
    assert "check_in_token" not in csv_text.splitlines()[0]
    assert "phone" not in csv_text.splitlines()[0]

    assert AuditEvent.objects.filter(action="EVENT_PARTICIPANT_ADMIN_CREATED").exists()
    assert AuditEvent.objects.filter(action="EVENT_PARTICIPANT_CSV_EXPORTED").exists()
    assert AuditEvent.objects.filter(action="EVENT_PARTICIPANT_BADGE_VIEWED").exists()

    # Capacity: second seat via register, third waitlisted, cancel promotes.
    second = client.post(
        base,
        {
            "participant_name": "Bob",
            "email": "bob@example.com",
            "mode": "register",
            "request_id": str(uuid4()),
        },
        content_type="application/json",
    )
    assert second.status_code == 201
    assert second.json()["status"] == "CONFIRMED"
    third = client.post(
        base,
        {
            "participant_name": "Cara",
            "email": "cara@example.com",
            "mode": "register",
            "request_id": str(uuid4()),
        },
        content_type="application/json",
    )
    assert third.status_code == 201
    assert third.json()["status"] == "WAITLISTED"
    cancel = client.post(
        f"{base}{second.json()['id']}/",
        {"action": "cancel"},
        content_type="application/json",
    )
    assert cancel.status_code == 200
    cara = EventRegistration.objects.get(pk=third.json()["id"])
    assert cara.status == RegistrationStatus.CONFIRMED


def test_participant_idor_and_public_isolation(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site_a = Site.objects.create(code="EVT-PA", name="Part A", organization_unit=owner)
    site_b = Site.objects.create(code="EVT-PB", name="Part B", organization_unit=owner)
    activate_site(site_a.pk)
    activate_site(site_b.pk)
    SiteDomain.objects.create(site=site_a, hostname="evt-pa.uog.edu.et", is_primary=True, status="ACTIVE")
    SiteDomain.objects.create(site=site_b, hostname="evt-pb.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_events(site_a)
    _enable_events(site_b)
    event_a = _event(site_a, slug="summit-a", title="Summit A")
    event_b = _event(site_b, slug="summit-b", title="Summit B")

    actor_a = _site_admin_client(client, oidc, site_a)
    created = client.post(
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/registrations/",
        {
            "participant_name": "Private Pat",
            "email": "pat@example.com",
            "phone": "+251900000000",
            "mode": "register",
            "request_id": str(uuid4()),
        },
        content_type="application/json",
    )
    assert created.status_code == 201, created.content
    registration_id = created.json()["id"]

    # Cross-site Site Admin cannot read private participant or badge.
    _site_admin_client(client, oidc, site_b)
    assert client.get(
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/registrations/{registration_id}/",
    ).status_code in {403, 404}
    assert client.get(
        f"/api/v1/sites/{site_b.pk}/events/{event_b.pk}/registrations/{registration_id}/",
    ).status_code == 404
    assert client.get(
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/registrations/{registration_id}/badge/",
    ).status_code in {403, 404}
    assert client.get(
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/registrations/export/",
    ).status_code in {403, 404}

    # Anonymous public Event APIs must not expose contact or badge data.
    client.logout()
    public = client.get(f"/api/v1/site-context/events/{event_a.slug}/", HTTP_HOST="evt-pa.uog.edu.et")
    assert public.status_code == 200
    payload = public.json()
    assert "pat@example.com" not in str(payload)
    assert "+251900000000" not in str(payload)
    assert client.get(
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/registrations/",
    ).status_code in {401, 403}
    assert client.get(
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/registrations/{registration_id}/badge/",
    ).status_code in {401, 403}

    speakers = client.get(
        f"/api/v1/site-context/events/{event_a.slug}/speakers/",
        HTTP_HOST="evt-pa.uog.edu.et",
    )
    assert speakers.status_code == 200
    assert speakers.json() == [] or "pat@example.com" not in str(speakers.json())

    # Soft-delete frees seat uniqueness for re-invite.
    _site_admin_client(client, oidc, site_a)
    deleted = client.post(
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/registrations/{registration_id}/",
        {"action": "delete"},
        content_type="application/json",
    )
    assert deleted.status_code == 200
    assert deleted.json()["deleted_at"]
    reinvite = client.post(
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/registrations/",
        {
            "participant_name": "Private Pat",
            "email": "pat@example.com",
            "mode": "invite",
            "request_id": str(uuid4()),
        },
        content_type="application/json",
    )
    assert reinvite.status_code == 201, reinvite.content
    assert actor_a  # keep fixture usage explicit
