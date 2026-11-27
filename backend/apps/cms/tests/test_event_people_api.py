"""EventPerson CRUD, session assignments, privacy, XSS, media ownership and IDOR."""
import uuid
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.cms.event_models import Event, EventStatus
from apps.cms.event_person_models import EventPerson, SessionPerson
from apps.cms.event_session_models import EventSession
from apps.media.models import MediaAsset
from apps.media.services import _media_write_session
from apps.sites.models import Module, Site, SiteDomain
from apps.sites.services.lifecycle import activate_site
from apps.sites.services.modules import enable_module_for_site
from tests.test_site_appearance_api import owner, _site_admin_client  # noqa: F401

pytestmark = pytest.mark.django_db


def _enable_events(site):
    enable_module_for_site(site.pk, Module.objects.get(code="EVENTS").pk)


def _event(site, **overrides):
    start = timezone.now().replace(microsecond=0) + timedelta(days=1)
    end = start + timedelta(days=2)
    payload = {
        "site": site,
        "title": "Summit",
        "slug": f"summit-{uuid.uuid4().hex[:8]}",
        "summary": "Speakers summit",
        "description": "<p>Agenda</p>",
        "starts_at": start,
        "ends_at": end,
        "timezone": "Africa/Addis_Ababa",
        "format": "PHYSICAL",
        "venue": "Campus",
        "status": EventStatus.DRAFT,
    }
    payload.update(overrides)
    return Event.objects.create(**payload)


def _session(event, **overrides):
    start = event.starts_at + timedelta(hours=1)
    end = start + timedelta(hours=1)
    payload = {
        "event": event,
        "day_date": timezone.localtime(start).date(),
        "starts_at": start,
        "ends_at": end,
        "title": "Keynote",
        "venue_room": "Hall A",
        "track": "Main",
    }
    payload.update(overrides)
    return EventSession.objects.create(**payload)


def _ready_image(site, user):
    with _media_write_session(user, site.pk):
        asset = MediaAsset.objects.create(
            site=site,
            storage_reference=f"platform-private:sites/{site.pk}/logo/{uuid.uuid4()}",
            original_filename="portrait.png",
            detected_mime="image/png",
            byte_count=128,
            checksum="d" * 64,
            status="PENDING",
            width=400,
            height=400,
            created_by=user,
            updated_by=user,
        )
        asset.status = "READY"
        asset.save(update_fields=("status",))
    return asset


def test_person_crud_assignment_cardinality_and_unassign(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="EVT-PPL", name="People Site", organization_unit=owner)
    _enable_events(site)
    _site_admin_client(client, oidc, site)
    event = _event(site)
    session_a = _session(event, title="Talk A")
    session_b = _session(
        event,
        title="Talk B",
        starts_at=event.starts_at + timedelta(hours=3),
        ends_at=event.starts_at + timedelta(hours=4),
        venue_room="Hall B",
    )
    people_url = f"/api/v1/sites/{site.pk}/events/{event.pk}/people/"

    created = client.post(
        people_url,
        {
            "display_name": "Dr. Ada",
            "affiliation": "Informatics",
            "biography": "<p>Safe bio<script>alert(1)</script></p>",
            "private_email": "ada@example.com",
            "private_phone": "+251911000000",
            "public_links": [{"label": "Site", "url": "https://example.com/ada"}],
            "visibility": "PUBLIC",
        },
        content_type="application/json",
    )
    assert created.status_code == 201, created.content
    person_id = created.json()["id"]
    assert "<script" not in created.json()["biography"].lower()
    assert created.json()["private_email"] == "ada@example.com"
    etag = created["ETag"]

    moderator = client.post(
        people_url,
        {"display_name": "Mod Mo", "visibility": "PUBLIC"},
        content_type="application/json",
    )
    assert moderator.status_code == 201
    mod_id = moderator.json()["id"]

    assign_a = client.post(
        f"/api/v1/sites/{site.pk}/events/{event.pk}/sessions/{session_a.pk}/people/",
        {"person": person_id, "role": "SPEAKER"},
        content_type="application/json",
    )
    assert assign_a.status_code == 201, assign_a.content
    assign_mod = client.post(
        f"/api/v1/sites/{site.pk}/events/{event.pk}/sessions/{session_a.pk}/people/",
        {"person": mod_id, "role": "MODERATOR"},
        content_type="application/json",
    )
    assert assign_mod.status_code == 201
    assign_b = client.post(
        f"/api/v1/sites/{site.pk}/events/{event.pk}/sessions/{session_b.pk}/people/",
        {"person": person_id, "role": "SPEAKER"},
        content_type="application/json",
    )
    assert assign_b.status_code == 201
    assert SessionPerson.objects.filter(person_id=person_id).count() == 2

    listed = client.get(f"/api/v1/sites/{site.pk}/events/{event.pk}/sessions/{session_a.pk}/people/")
    assert listed.status_code == 200
    roles = {row["role"] for row in listed.json()["results"]}
    assert roles == {"SPEAKER", "MODERATOR"}

    removed = client.delete(
        f"/api/v1/sites/{site.pk}/events/{event.pk}/sessions/{session_a.pk}/people/{assign_a.json()['id']}/",
    )
    assert removed.status_code == 204
    assert EventPerson.objects.filter(pk=person_id, removed_at__isnull=True).exists()
    assert SessionPerson.objects.filter(person_id=person_id, session=session_b).exists()
    assert not SessionPerson.objects.filter(pk=assign_a.json()["id"]).exists()

    soft = client.delete(f"{people_url}{person_id}/", HTTP_IF_MATCH=etag)
    assert soft.status_code == 200
    assert EventPerson.objects.get(pk=person_id).removed_at is not None


def test_public_agenda_omits_private_fields_and_hidden_people(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="EVT-PUBP", name="Public People", organization_unit=owner)
    activate_site(site.pk)
    SiteDomain.objects.create(site=site, hostname="evt-people.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_events(site)
    _site_admin_client(client, oidc, site)
    event = _event(site, status=EventStatus.PUBLISHED, published_at=timezone.now())
    session = _session(event)
    people_url = f"/api/v1/sites/{site.pk}/events/{event.pk}/people/"

    public_person = client.post(
        people_url,
        {
            "display_name": "Public Speaker",
            "private_email": "secret@example.com",
            "private_phone": "hidden",
            "visibility": "PUBLIC",
        },
        content_type="application/json",
    ).json()
    hidden_person = client.post(
        people_url,
        {"display_name": "Hidden Speaker", "private_email": "hide@example.com", "visibility": "HIDDEN"},
        content_type="application/json",
    ).json()
    client.post(
        f"/api/v1/sites/{site.pk}/events/{event.pk}/sessions/{session.pk}/people/",
        {"person": public_person["id"], "role": "SPEAKER"},
        content_type="application/json",
    )
    client.post(
        f"/api/v1/sites/{site.pk}/events/{event.pk}/sessions/{session.pk}/people/",
        {"person": hidden_person["id"], "role": "PANELIST"},
        content_type="application/json",
    )

    client.defaults.clear()
    agenda = client.get(
        f"/api/v1/site-context/events/{event.slug}/agenda/",
        HTTP_HOST="evt-people.uog.edu.et",
    )
    assert agenda.status_code == 200, agenda.content
    people = agenda.json()["days"][0]["tracks"][0]["sessions"][0]["people"]
    names = {row["person_summary"]["display_name"] for row in people}
    assert "Public Speaker" in names
    assert "Hidden Speaker" not in names
    summary = people[0]["person_summary"]
    assert "private_email" not in summary
    assert "private_phone" not in summary
    assert "secret@" not in str(agenda.json())


def test_foreign_media_and_cross_site_idor(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site_a = Site.objects.create(code="EVT-PA", name="People A", organization_unit=owner)
    site_b = Site.objects.create(code="EVT-PB", name="People B", organization_unit=owner)
    _enable_events(site_a)
    _enable_events(site_b)
    actor_a = _site_admin_client(client, oidc, site_a)
    foreign = _ready_image(site_b, actor_a)
    local = _ready_image(site_a, actor_a)
    event_a = _event(site_a)
    event_b = _event(site_b)

    rejected = client.post(
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/people/",
        {"display_name": "Ada", "profile_photo": str(foreign.pk)},
        content_type="application/json",
    )
    assert rejected.status_code == 400

    accepted = client.post(
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/people/",
        {"display_name": "Ada", "profile_photo": str(local.pk)},
        content_type="application/json",
    )
    assert accepted.status_code == 201, accepted.content
    person_id = accepted.json()["id"]

    bad_link = client.post(
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/people/",
        {"display_name": "Bad", "public_links": [{"label": "x", "url": "javascript:alert(1)"}]},
        content_type="application/json",
    )
    assert bad_link.status_code == 400

    _site_admin_client(client, oidc, site_b)
    assert client.get(f"/api/v1/sites/{site_b.pk}/events/{event_a.pk}/people/{person_id}/").status_code == 404
    session_b = _session(event_b)
    cross = client.post(
        f"/api/v1/sites/{site_b.pk}/events/{event_b.pk}/sessions/{session_b.pk}/people/",
        {"person": person_id, "role": "SPEAKER"},
        content_type="application/json",
    )
    assert cross.status_code == 400


def test_assigned_person_overlap_warning(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="EVT-OVLP", name="Overlap People", organization_unit=owner)
    _enable_events(site)
    _site_admin_client(client, oidc, site)
    event = _event(site)
    start = event.starts_at + timedelta(hours=2)
    end = start + timedelta(hours=1)
    session_a = _session(event, title="A", starts_at=start, ends_at=end, venue_room="R1")
    session_b = _session(event, title="B", starts_at=start, ends_at=end, venue_room="R2")
    person = client.post(
        f"/api/v1/sites/{site.pk}/events/{event.pk}/people/",
        {"display_name": "Busy Speaker"},
        content_type="application/json",
    ).json()
    for session in (session_a, session_b):
        assert client.post(
            f"/api/v1/sites/{site.pk}/events/{event.pk}/sessions/{session.pk}/people/",
            {"person": person["id"], "role": "SPEAKER"},
            content_type="application/json",
        ).status_code == 201

    listed = client.get(f"/api/v1/sites/{site.pk}/events/{event.pk}/sessions/")
    assert listed.status_code == 200
    warnings = listed.json()["conflicts"]["speaker_warnings"]
    assert warnings
    assert any("Busy Speaker" in item["message"] for item in warnings)
