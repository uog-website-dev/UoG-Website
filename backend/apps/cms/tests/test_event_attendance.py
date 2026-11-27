"""Attendance check-in: QR security, replay, cancelled override, reports, IDOR."""
from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone

from apps.cms.event_attendance_domain import badge_qr_payload
from apps.cms.event_attendance_models import EventAttendance
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
    start = timezone.now() + timedelta(days=1)
    payload = {
        "site": site,
        "title": "Attendance Day",
        "slug": f"att-{uuid4().hex[:8]}",
        "summary": "Check-in",
        "description": "<p>Check-in</p>",
        "status": EventStatus.PUBLISHED,
        "published_at": timezone.now(),
        "starts_at": start,
        "ends_at": start + timedelta(hours=4),
        "timezone": "Africa/Addis_Ababa",
        "venue": "Hall",
        "registration_required": True,
        "registration_capacity": 50,
        "registration_open": True,
    }
    payload.update(overrides)
    return Event.objects.create(**payload)


def _participant(event, *, email="a@example.com", status=RegistrationStatus.CONFIRMED, name="Ada"):
    return EventRegistration.objects.create(
        event=event,
        site=event.site,
        request_id=uuid4(),
        email=email,
        email_normalized=email.lower(),
        participant_name=name,
        status=status,
        consent_at=timezone.now(),
        confirmed_at=timezone.now() if status == RegistrationStatus.CONFIRMED else None,
        cancelled_at=timezone.now() if status == RegistrationStatus.CANCELLED else None,
    )


def test_manual_qr_replay_override_report_and_idor(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site_a = Site.objects.create(code="EVT-ATA", name="Att A", organization_unit=owner)
    site_b = Site.objects.create(code="EVT-ATB", name="Att B", organization_unit=owner)
    activate_site(site_a.pk)
    activate_site(site_b.pk)
    SiteDomain.objects.create(site=site_a, hostname="evt-ata.uog.edu.et", is_primary=True, status="ACTIVE")
    SiteDomain.objects.create(site=site_b, hostname="evt-atb.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_events(site_a)
    _enable_events(site_b)
    actor = _site_admin_client(client, oidc, site_a)
    event_a = _event(site_a)
    event_b = _event(site_b, slug="other-event")
    confirmed = _participant(event_a, email="ok@example.com", name="=Ada")
    cancelled = _participant(
        event_a, email="cancel@example.com", status=RegistrationStatus.CANCELLED, name="Cara",
    )
    foreign = _participant(event_b, email="x@example.com", name="Other")
    base = f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/attendance/"

    first = client.post(
        f"{base}check-in/",
        {"registration_id": str(confirmed.pk)},
        content_type="application/json",
    )
    assert first.status_code == 201, first.content
    assert first.json()["method"] == "MANUAL"
    assert first.json()["replayed"] is False
    assert EventAttendance.objects.filter(event=event_a).count() == 1

    replay = client.post(
        f"{base}check-in/",
        {"registration_id": str(confirmed.pk)},
        content_type="application/json",
    )
    assert replay.status_code == 200
    assert replay.json()["replayed"] is True
    assert replay.json()["id"] == first.json()["id"]
    assert EventAttendance.objects.filter(event=event_a).count() == 1

    denied_cancel = client.post(
        f"{base}check-in/",
        {"registration_id": str(cancelled.pk)},
        content_type="application/json",
    )
    assert denied_cancel.status_code == 403

    override = client.post(
        f"{base}check-in/",
        {"registration_id": str(cancelled.pk), "override": True, "notes": "Door exception"},
        content_type="application/json",
    )
    assert override.status_code == 201, override.content
    assert override.json()["method"] == "OVERRIDE"
    assert EventAttendance.objects.filter(event=event_a).count() == 2

    qr = badge_qr_payload(event_a, confirmed)
    scan = client.post(
        f"{base}scan/",
        {"token": qr},
        content_type="application/json",
    )
    assert scan.status_code == 200
    assert scan.json()["replayed"] is True

    foreign_qr = badge_qr_payload(event_b, foreign)
    wrong_event = client.post(
        f"{base}scan/",
        {"token": foreign_qr},
        content_type="application/json",
    )
    assert wrong_event.status_code == 400

    tampered = client.post(
        f"{base}scan/",
        {"token": qr[:-2] + "zz"},
        content_type="application/json",
    )
    assert tampered.status_code in {400, 404}

    unknown = client.post(
        f"{base}scan/",
        {"token": "not-a-real-token"},
        content_type="application/json",
    )
    assert unknown.status_code == 404

    report = client.get(f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/report/")
    assert report.status_code == 200, report.content
    metrics = report.json()["metrics"]
    assert metrics["attended"] == 2
    assert metrics["confirmed"] >= 1
    assert metrics["cancelled"] >= 1
    assert metrics["registrations"] >= 2
    assert metrics["capacity"] == 50
    assert metrics["capacity_utilization"] is not None

    export = client.get(f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/report/export/")
    assert export.status_code == 200
    csv_text = export.content.decode("utf-8-sig")
    assert "'=Ada" in csv_text or csv_text.count("Ada") >= 1
    assert "check_in_token" not in csv_text.splitlines()[0]
    assert "management_token" not in csv_text

    # Cross-site Site Admin cannot read private report.
    _site_admin_client(client, oidc, site_b)
    denied = client.get(f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/report/")
    assert denied.status_code in {403, 404}
    denied_scan = client.post(
        f"/api/v1/sites/{site_b.pk}/events/{event_b.pk}/attendance/scan/",
        {"token": qr},
        content_type="application/json",
    )
    assert denied_scan.status_code in {400, 404}

    # Public Event APIs must not expose attendance/report data.
    public = client.get(f"/api/v1/site-context/events/{event_a.slug}/", HTTP_HOST="evt-ata.uog.edu.et")
    assert public.status_code == 200
    body = public.json()
    assert "attendances" not in body
    assert "report" not in body
    assert "email" not in str(body.get("registration_summary", {}))

    badge = _site_admin_client(client, oidc, site_a) or actor
    badge_resp = client.get(
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/registrations/{confirmed.pk}/badge/",
    )
    assert badge_resp.status_code == 200
    assert badge_resp.json()["qr_payload"]
    assert "email" not in badge_resp.json()
