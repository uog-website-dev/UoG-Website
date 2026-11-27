"""Event registration capacity, waitlist, duplicates, PII and window gates."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta
from uuid import uuid4

import pytest
from django.db import connection
from django.utils import timezone

from apps.cms.event_models import Event, EventStatus
from apps.cms.event_registration_models import EventRegistration, RegistrationStatus
from apps.sites.models import Module, Site, SiteDomain
from apps.sites.services.lifecycle import activate_site
from apps.sites.services.modules import enable_module_for_site
from tests.test_site_appearance_api import owner  # noqa: F401

pytestmark = pytest.mark.django_db


def _enable_events(site):
    module, _ = Module.objects.get_or_create(
        code="EVENTS",
        defaults={
            "name": "Events",
            "description": "Events",
            "status": "IMPLEMENTED",
            "is_enabled": True,
        },
    )
    if module.status != "IMPLEMENTED" or not module.is_enabled:
        module.status = "IMPLEMENTED"
        module.is_enabled = True
        module.save(update_fields=["status", "is_enabled"])
    enable_module_for_site(site.pk, module.pk)


def _event(site, **overrides):
    start = timezone.now() + timedelta(days=2)
    payload = {
        "site": site,
        "title": "Open Seminar",
        "slug": "open-seminar",
        "summary": "Public seminar",
        "description": "<p>Join us</p>",
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
        "registration_notice": "Bring an ID card.",
    }
    payload.update(overrides)
    return Event.objects.create(**payload)


def _register(client, host, slug, **fields):
    body = {
        "request_id": str(uuid4()),
        "participant_name": "Visitor One",
        "email": "visitor@example.com",
        "consent": True,
        "website": "",
        **fields,
    }
    return client.post(
        f"/api/v1/site-context/events/{slug}/registrations/",
        body,
        content_type="application/json",
        HTTP_HOST=host,
        HTTP_ORIGIN=f"http://{host}",
    )


def test_registration_capacity_waitlist_cancel_and_promotion(client, owner, settings):
    settings.DEBUG = True
    site = Site.objects.create(code="EVT-REG", name="Reg Site", organization_unit=owner)
    activate_site(site.pk)
    SiteDomain.objects.create(site=site, hostname="evt-reg.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_events(site)
    event = _event(site)

    first = _register(client, "evt-reg.uog.edu.et", event.slug, email="a@example.com", participant_name="A")
    assert first.status_code == 201, first.content
    assert first.json()["status"] == "CONFIRMED"
    assert "management_token" in first.json()
    assert "email" not in first.json()

    second = _register(client, "evt-reg.uog.edu.et", event.slug, email="b@example.com", participant_name="B")
    assert second.status_code == 201
    waitlisted = _register(client, "evt-reg.uog.edu.et", event.slug, email="c@example.com", participant_name="C")
    assert waitlisted.status_code == 202, waitlisted.content
    assert waitlisted.json()["status"] == "WAITLISTED"
    assert waitlisted.json()["waitlist_position"] == 1

    detail = client.get(f"/api/v1/site-context/events/{event.slug}/", HTTP_HOST="evt-reg.uog.edu.et")
    assert detail.status_code == 200
    assert detail.json()["registration_state"] == "WAITLIST_AVAILABLE"
    assert "a@example.com" not in str(detail.json())
    assert detail.json()["registration_summary"]["state"] == "WAITLIST_AVAILABLE"

    cancel = client.post(
        f"/api/v1/site-context/events/{event.slug}/registrations/cancel/",
        {"email": "a@example.com", "token": first.json()["management_token"]},
        content_type="application/json",
        HTTP_HOST="evt-reg.uog.edu.et",
        HTTP_ORIGIN="http://evt-reg.uog.edu.et",
    )
    assert cancel.status_code == 200, cancel.content
    assert cancel.json()["status"] == "CANCELLED"
    promoted = EventRegistration.objects.get(email_normalized="c@example.com")
    assert promoted.status == RegistrationStatus.CONFIRMED

    duplicate = _register(client, "evt-reg.uog.edu.et", event.slug, email="B@example.com", participant_name="B2")
    assert duplicate.status_code == 409


def test_registration_rejects_closed_draft_and_honeypot(client, owner, settings):
    settings.DEBUG = True
    site = Site.objects.create(code="EVT-REG2", name="Reg Closed", organization_unit=owner)
    activate_site(site.pk)
    SiteDomain.objects.create(site=site, hostname="evt-closed.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_events(site)
    live = _event(site, slug="no-reg", registration_required=False)
    draft = _event(site, slug="draft-reg", status=EventStatus.DRAFT, published_at=None, title="Draft")
    windowed = _event(
        site,
        slug="window-reg",
        title="Window",
        registration_opens_at=timezone.now() + timedelta(days=1),
        registration_capacity=10,
        waitlist_enabled=False,
    )

    assert client.get("/api/v1/site-context/events/no-reg/", HTTP_HOST="evt-closed.uog.edu.et").json()["registration_state"] == "OFF"
    assert _register(client, "evt-closed.uog.edu.et", live.slug).status_code == 400
    assert _register(client, "evt-closed.uog.edu.et", draft.slug).status_code == 404
    assert _register(client, "evt-closed.uog.edu.et", windowed.slug).status_code == 400
    spam = _register(client, "evt-closed.uog.edu.et", windowed.slug, website="http://spam.test")
    # Still closed, but honeypot is checked first when open; for closed window ValidationError wins.
    assert spam.status_code in (400, 404)

    open_event = _event(site, slug="open-now", title="Open now", registration_capacity=5, waitlist_enabled=False)
    honeypot = _register(client, "evt-closed.uog.edu.et", open_event.slug, website="bots")
    assert honeypot.status_code == 400
    assert EventRegistration.objects.filter(event=open_event).count() == 0


@pytest.mark.django_db(transaction=True)
def test_concurrent_last_seat_does_not_overbook(owner, settings):
    settings.DEBUG = True
    from apps.cms.event_registration_domain import (
        RegistrationClosed,
        RegistrationDuplicate,
        RegistrationFull,
        create_registration,
        event_accepts_registration,
    )

    site = Site.objects.create(code="EVT-RACE", name="Race Site", organization_unit=owner)
    activate_site(site.pk)
    _enable_events(site)
    event = _event(site, slug="last-seat", registration_capacity=1, waitlist_enabled=False)
    event_id = event.pk
    assert event_accepts_registration(event) is True

    def domain_attempt(index):
        connection.close()
        try:
            row = create_registration(
                Event.objects.get(pk=event_id),
                {
                    "request_id": uuid4(),
                    "participant_name": f"Racer {index}",
                    "email": f"racer{index}@example.com",
                    "consent": True,
                },
            )
            return row.status
        except (RegistrationFull, RegistrationDuplicate, RegistrationClosed):
            return "REJECTED"
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(domain_attempt, range(8)))

    assert results.count("CONFIRMED") == 1, results
    assert EventRegistration.objects.filter(event_id=event_id, status=RegistrationStatus.CONFIRMED).count() == 1
    assert EventRegistration.objects.filter(event_id=event_id).exclude(status=RegistrationStatus.CANCELLED).count() == 1
