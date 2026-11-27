"""P0-EVENT-015 release gate: University Main + pilot college Event workflow."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import timedelta
from uuid import uuid4
import hashlib
import io

import pytest
from django.db import connection
from django.utils import timezone

from apps.audit.models import AuditEvent
from apps.cms.event_domain import event_etag
from apps.cms.event_models import Event, EventStatus
from apps.cms.event_pilot import SEMINAR_SLUG, SYMPOSIUM_SLUG, seed_site_pilots
from apps.cms.event_registration_domain import (
    RegistrationClosed,
    RegistrationDuplicate,
    RegistrationFull,
    create_registration,
)
from apps.cms.event_registration_models import EventRegistration, RegistrationStatus
from apps.cms.event_session_domain import session_etag
from apps.cms.event_update_domain import PUBLIC_UPDATES_MAX_AGE
from apps.cms.event_update_models import EventSessionRevision
from apps.cms.models import Document
from apps.media.models import MediaAsset, MediaProcessing
from apps.media.services import _media_write_session
from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.sites.models import Module, Site, SiteDomain
from apps.sites.models.event_settings import SiteEventSettings
from apps.sites.services.lifecycle import activate_site
from apps.sites.services.modules import disable_module_for_site, enable_module_for_site
from tests.test_site_appearance_api import owner, _site_admin_client  # noqa: F401

pytestmark = pytest.mark.django_db


def _enable(site, *codes):
    for code in codes:
        module, _ = Module.objects.get_or_create(
            code=code,
            defaults={"name": code.title(), "description": code, "status": "IMPLEMENTED", "is_enabled": True},
        )
        if module.status != "IMPLEMENTED" or not module.is_enabled:
            module.status = "IMPLEMENTED"
            module.is_enabled = True
            module.save(update_fields=["status", "is_enabled"])
        enable_module_for_site(site.pk, module.pk)


def _host(site, hostname):
    activate_site(site.pk)
    SiteDomain.objects.create(site=site, hostname=hostname, is_primary=True, status="ACTIVE")


def _ready_document(site, user, *, title="Session Slides"):
    from pypdf import PdfWriter
    from apps.media.processing import process_asset

    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    output = io.BytesIO()
    writer.write(output)
    body = output.getvalue()

    class MemoryStorage:
        def __init__(self):
            self.objects = {}

        @contextmanager
        def open(self, bucket, key):
            yield io.BytesIO(self.objects[(bucket, key)])

        def put(self, bucket, key, data, **kwargs):
            self.objects[(bucket, key)] = data if isinstance(data, (bytes, bytearray)) else data.read()

    storage = MemoryStorage()
    reference = f"platform-documents:sites/{site.pk}/assets/{uuid4()}"
    bucket, key = reference.split(":", 1)
    storage.objects[(bucket, key)] = body
    with _media_write_session(user, site.pk):
        asset = MediaAsset.objects.create(
            site=site,
            storage_reference=reference,
            original_filename="slides.pdf",
            detected_mime="application/pdf",
            byte_count=len(body),
            checksum=hashlib.sha256(body).hexdigest(),
            status="PENDING",
            created_by=user,
            updated_by=user,
        )
        MediaProcessing.objects.create(asset=asset, state="QUEUED")
    asset = process_asset(asset.pk, storage=storage)
    assert asset.status == "READY" and asset.processing.state == "READY"
    document = Document.objects.create(
        site=site,
        title=title,
        slug=f"{title.lower().replace(' ', '-')}-{uuid4().hex[:6]}",
        file_reference=f"sites/{site.pk}/assets/{asset.pk}",
        created_by=user,
        updated_by=user,
    )
    return document, body, storage, key


def _ready_image(site, user):
    from apps.media.processing import process_asset
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (96, 64), color=(30, 90, 140)).save(buffer, format="PNG")
    body = buffer.getvalue()

    class MemoryStorage:
        def __init__(self):
            self.objects = {}

        @contextmanager
        def open(self, bucket, key):
            yield io.BytesIO(self.objects[(bucket, key)])

        def put(self, bucket, key, data, content_type=None, cache_control=None):
            self.objects[(bucket, key)] = data if isinstance(data, (bytes, bytearray)) else data.read()

    storage = MemoryStorage()
    reference = f"platform-private:sites/{site.pk}/uploads/{uuid4()}.png"
    bucket, key = reference.split(":", 1)
    storage.objects[(bucket, key)] = body
    with _media_write_session(user, site.pk):
        asset = MediaAsset.objects.create(
            site=site,
            storage_reference=reference,
            original_filename="live.png",
            detected_mime="image/png",
            byte_count=len(body),
            checksum=hashlib.sha256(body).hexdigest(),
            status="PENDING",
            width=96,
            height=64,
            alt_text="Live symposium photo",
            created_by=user,
            updated_by=user,
        )
        MediaProcessing.objects.create(asset=asset, state="QUEUED")
    return process_asset(asset.pk, storage=storage)


def test_release_pilot_main_and_college_workflow(client, oidc, owner, settings, monkeypatch):
    """End-to-end release acceptance for Main aggregation + independent college Site."""
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    root = owner.parent
    college_type = OrganizationType.objects.get(code="COLLEGE")
    college_ou = OrganizationUnit.objects.create(
        code=f"COL-REL-{uuid4().hex[:5]}",
        name="Pilot College of Informatics",
        parent=root,
        organization_type=college_type,
    )
    main = Site.objects.create(
        code="EVT-REL-MAIN", name="University Main", organization_unit=root, is_main=True,
    )
    college = Site.objects.create(
        code="EVT-REL-COL", name="Pilot College Site", organization_unit=college_ou,
    )
    other = Site.objects.create(
        code="EVT-REL-OTH", name="Non-eligible College", organization_unit=college_ou,
    )
    _host(main, "main-rel.uog.edu.et")
    _host(college, "college-rel.uog.edu.et")
    _host(other, "other-rel.uog.edu.et")
    _enable(main, "EVENTS")
    _enable(college, "EVENTS", "MEDIA", "DOCUMENTS")
    _enable(other, "EVENTS")
    SiteEventSettings.objects.update_or_create(
        site=college, defaults={"public_aggregation_eligible": True},
    )
    SiteEventSettings.objects.update_or_create(
        site=other, defaults={"public_aggregation_eligible": False},
    )

    main_admin = _site_admin_client(client, oidc, main)
    main_pilots = seed_site_pilots(main, actor=main_admin)
    seminar = main_pilots["seminar"]["event"]
    # Publish seminar via admin API
    detail = client.get(f"/api/v1/sites/{main.pk}/events/{seminar.pk}/")
    assert detail.status_code == 200
    published = client.post(
        f"/api/v1/sites/{main.pk}/events/{seminar.pk}/publish/",
        {},
        content_type="application/json",
        HTTP_IF_MATCH=detail["ETag"],
    )
    assert published.status_code == 200, published.content
    assert published.json()["status"] == "PUBLISHED"
    seminar.refresh_from_db()
    seminar_version = seminar.version

    college_admin = _site_admin_client(client, oidc, college)
    college_pilots = seed_site_pilots(college, actor=college_admin)
    symposium = college_pilots["symposium"]["event"]
    sessions = college_pilots["symposium"]["sessions"]
    detail = client.get(f"/api/v1/sites/{college.pk}/events/{symposium.pk}/")
    published = client.post(
        f"/api/v1/sites/{college.pk}/events/{symposium.pk}/publish/",
        {},
        content_type="application/json",
        HTTP_IF_MATCH=detail["ETag"],
    )
    assert published.status_code == 200, published.content
    symposium.refresh_from_db()

    # Mark symposium In Progress for live mid-event updates without collapsing the schedule window.
    symposium.starts_at = timezone.now() - timedelta(hours=1)
    symposium.save(update_fields=["starts_at", "updated_at"])
    symposium.refresh_from_db()
    root_version = symposium.version

    # Calendar + detail on college hostname.
    calendar = client.get(
        "/api/v1/site-context/events/calendar/",
        {
            "year": timezone.localtime(symposium.starts_at).year,
            "month": timezone.localtime(symposium.starts_at).month,
        },
        HTTP_HOST="college-rel.uog.edu.et",
    )
    assert calendar.status_code == 200
    detail_public = client.get(
        f"/api/v1/site-context/events/{SYMPOSIUM_SLUG}/",
        HTTP_HOST="college-rel.uog.edu.et",
    )
    assert detail_public.status_code == 200
    public_body = detail_public.content.decode("utf-8", errors="ignore")
    assert "attendee@" not in public_body
    assert detail_public.json()["sections"]["schedule"] is True
    assert detail_public.json()["sections"]["speakers"] is True

    agenda = client.get(
        f"/api/v1/site-context/events/{SYMPOSIUM_SLUG}/agenda/",
        HTTP_HOST="college-rel.uog.edu.et",
    )
    assert agenda.status_code == 200
    assert len(agenda.json()["days"]) >= 2
    speakers = client.get(
        f"/api/v1/site-context/events/{SYMPOSIUM_SLUG}/speakers/",
        HTTP_HOST="college-rel.uog.edu.et",
    )
    assert speakers.status_code == 200
    assert len(speakers.json()["results"]) >= 1
    speaker_payload = speakers.content.decode("utf-8", errors="ignore")
    assert "@" not in speaker_payload
    assert "phone" not in speaker_payload.lower()

    # University Main aggregates eligible published college Event + own seminar; not other college.
    main_list = client.get("/api/v1/site-context/events/", HTTP_HOST="main-rel.uog.edu.et")
    assert main_list.status_code == 200
    slugs = {row["slug"] for row in main_list.json()["results"]}
    assert SEMINAR_SLUG in slugs
    assert SYMPOSIUM_SLUG in slugs
    # Ownership stays with college — Main aggregation does not rewrite Site ownership.
    college_row = next(row for row in main_list.json()["results"] if row["slug"] == SYMPOSIUM_SLUG)
    assert college_row["site"] == college.pk
    assert college_row.get("site_code") == college.code

    college_list = client.get("/api/v1/site-context/events/", HTTP_HOST="college-rel.uog.edu.et")
    college_slugs = {row["slug"] for row in college_list.json()["results"]}
    assert SYMPOSIUM_SLUG in college_slugs
    assert SEMINAR_SLUG not in college_slugs

    # Mid-event resource + gallery without republishing Event root.
    slides_doc, slides_body, storage, slides_key = _ready_document(
        college, college_admin, title="Track Slides",
    )
    pack_doc, pack_body, pack_storage, pack_key = _ready_document(
        college, college_admin, title="Registrant Pack",
    )
    storage.objects.update(pack_storage.objects)
    image = _ready_image(college, college_admin)
    bodies = {slides_key: slides_body, pack_key: pack_body}

    @contextmanager
    def open_object(self, bucket, object_key):
        yield io.BytesIO(bodies[object_key])

    monkeypatch.setattr("apps.media.storage.ObjectStorage.open", open_object)

    resource = client.post(
        f"/api/v1/sites/{college.pk}/events/{symposium.pk}/resources/",
        {
            "document": str(slides_doc.pk),
            "title": "Day-1 slides",
            "visibility": "PUBLIC",
            "category": "SLIDES",
            "session": str(sessions[0].pk),
        },
        content_type="application/json",
    )
    assert resource.status_code == 201, resource.content
    public_resource_id = resource.json()["id"]

    registered_only = client.post(
        f"/api/v1/sites/{college.pk}/events/{symposium.pk}/resources/",
        {
            "document": str(pack_doc.pk),
            "title": "Registrant pack",
            "visibility": "REGISTERED_ONLY",
            "category": "HANDOUT",
        },
        content_type="application/json",
    )
    assert registered_only.status_code == 201, registered_only.content
    private_resource_id = registered_only.json()["id"]

    gallery = client.post(
        f"/api/v1/sites/{college.pk}/events/{symposium.pk}/gallery/",
        {
            "items": [{
                "media_asset": str(image.pk),
                "caption": "Live hall",
                "alt_text": "Participants in the auditorium",
                "usage_consent": True,
                "is_published": True,
                "session": str(sessions[0].pk),
            }],
        },
        content_type="application/json",
    )
    assert gallery.status_code == 201, gallery.content
    symposium.refresh_from_db()
    assert symposium.version == root_version

    public_files = client.get(
        f"/api/v1/site-context/events/{SYMPOSIUM_SLUG}/resources/",
        HTTP_HOST="college-rel.uog.edu.et",
    )
    assert public_files.status_code == 200
    by_id = {row["id"]: row for row in public_files.json()}
    assert public_resource_id in by_id
    assert private_resource_id in by_id
    assert by_id[private_resource_id]["visibility"] == "REGISTERED_ONLY"
    assert "document" not in by_id[public_resource_id]

    anon_private = client.get(
        f"/api/v1/site-context/events/{SYMPOSIUM_SLUG}/resources/{private_resource_id}/file/",
        HTTP_HOST="college-rel.uog.edu.et",
    )
    assert anon_private.status_code in {401, 403, 404}

    registration = client.post(
        f"/api/v1/site-context/events/{SYMPOSIUM_SLUG}/registrations/",
        {
            "request_id": str(uuid4()),
            "participant_name": "Pilot Attendee",
            "email": "attendee@example.com",
            "organization": "Pilot College",
            "consent": True,
            "website": "",
        },
        content_type="application/json",
        HTTP_HOST="college-rel.uog.edu.et",
        HTTP_ORIGIN="http://college-rel.uog.edu.et",
    )
    assert registration.status_code in {201, 202}, registration.content
    token = registration.json()["management_token"]
    assert "email" not in registration.json()

    grant = client.post(
        f"/api/v1/site-context/events/{SYMPOSIUM_SLUG}/resources/{private_resource_id}/entitlement/",
        {"email": "attendee@example.com", "token": token},
        content_type="application/json",
        HTTP_HOST="college-rel.uog.edu.et",
    )
    assert grant.status_code == 200, grant.content
    download = client.get(
        f"/api/v1/site-context/events/{SYMPOSIUM_SLUG}/resources/{private_resource_id}/file/"
        f"?grant={grant.json()['grant']}",
        HTTP_HOST="college-rel.uog.edu.et",
    )
    assert download.status_code == 200

    # Schedule change + published update; cache freshness headers; audit trail.
    session = sessions[1]
    session.refresh_from_db()
    new_start = session.starts_at + timedelta(minutes=30)
    new_end = session.ends_at + timedelta(minutes=30)
    moved = client.patch(
        f"/api/v1/sites/{college.pk}/events/{symposium.pk}/sessions/{session.pk}/",
        {
            "starts_at": new_start.isoformat(),
            "ends_at": new_end.isoformat(),
            "venue_room": "Room 105",
        },
        content_type="application/json",
        HTTP_IF_MATCH=session_etag(session),
    )
    assert moved.status_code == 200, moved.content
    assert EventSessionRevision.objects.filter(session_id=session.pk).exists()
    assert AuditEvent.objects.filter(
        action="EVENT_SESSION_UPDATED", entity_id=str(session.pk),
    ).exists()

    update = client.post(
        f"/api/v1/sites/{college.pk}/events/{symposium.pk}/updates/",
        {
            "title": "Room change",
            "body": "<p>Health panel moved to Room 105.</p><script>alert(1)</script>",
            "severity": "IMPORTANT",
            "pinned": True,
        },
        content_type="application/json",
    )
    assert update.status_code == 201, update.content
    assert "<script" not in update.json()["body"].lower()
    update_id = update.json()["id"]
    assert client.get(
        f"/api/v1/site-context/events/{SYMPOSIUM_SLUG}/updates/",
        HTTP_HOST="college-rel.uog.edu.et",
    ).json() == []
    published_update = client.post(
        f"/api/v1/sites/{college.pk}/events/{symposium.pk}/updates/{update_id}/action/",
        {"action": "publish"},
        content_type="application/json",
    )
    assert published_update.status_code == 200, published_update.content
    public_updates = client.get(
        f"/api/v1/site-context/events/{SYMPOSIUM_SLUG}/updates/",
        HTTP_HOST="college-rel.uog.edu.et",
    )
    assert public_updates.status_code == 200
    assert len(public_updates.json()) == 1
    assert public_updates["X-Events-Cache-Freshness-Seconds"] == str(PUBLIC_UPDATES_MAX_AGE)
    assert "max-age=30" in public_updates["Cache-Control"]
    symposium.refresh_from_db()
    assert symposium.version == root_version

    # Cancellation / archival behavior on Main seminar.
    _site_admin_client(client, oidc, main)
    seminar.refresh_from_db()
    cancelled = client.post(
        f"/api/v1/sites/{main.pk}/events/{seminar.pk}/cancel/",
        {"notice": "Seminar postponed."},
        content_type="application/json",
        HTTP_IF_MATCH=event_etag(seminar),
    )
    assert cancelled.status_code == 200, cancelled.content
    assert cancelled.json()["status"] == "CANCELLED"
    cancelled_public = client.get(
        f"/api/v1/site-context/events/{SEMINAR_SLUG}/",
        HTTP_HOST="main-rel.uog.edu.et",
    )
    assert cancelled_public.status_code == 200
    assert cancelled_public.json()["accepts_registration"] is False
    seminar.refresh_from_db()
    archived = client.post(
        f"/api/v1/sites/{main.pk}/events/{seminar.pk}/archive/",
        {},
        content_type="application/json",
        HTTP_IF_MATCH=event_etag(seminar),
    )
    assert archived.status_code == 200, archived.content
    assert client.get(
        f"/api/v1/site-context/events/{SEMINAR_SLUG}/",
        HTTP_HOST="main-rel.uog.edu.et",
    ).status_code == 404

    # Cross-Site negative authorization.
    _site_admin_client(client, oidc, main)
    assert client.get(
        f"/api/v1/sites/{main.pk}/events/{symposium.pk}/",
    ).status_code == 404
    assert client.get(
        f"/api/v1/sites/{college.pk}/events/{symposium.pk}/registrations/export/",
    ).status_code in {403, 404}

    # Module toggle on college.
    _site_admin_client(client, oidc, college)
    disable_module_for_site(college.pk, Module.objects.get(code="EVENTS").pk)
    assert client.post(
        f"/api/v1/sites/{college.pk}/events/{symposium.pk}/updates/",
        {"title": "Blocked", "body": "<p>x</p>", "severity": "INFO"},
        content_type="application/json",
    ).status_code == 403
    assert client.get(
        f"/api/v1/site-context/events/{SYMPOSIUM_SLUG}/",
        HTTP_HOST="college-rel.uog.edu.et",
    ).status_code == 404
    assert Event.objects.filter(pk=symposium.pk, status=EventStatus.PUBLISHED).exists()
    assert seminar_version >= 1


@pytest.mark.django_db(transaction=True)
def test_release_concurrent_last_seat_capacity(owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="EVT-REL-RACE", name="Race", organization_unit=owner)
    activate_site(site.pk)
    _enable(site, "EVENTS")
    from apps.cms.event_pilot import build_seminar

    bundle = build_seminar(site)
    event = bundle["event"]
    event.status = EventStatus.PUBLISHED
    event.published_at = timezone.now()
    event.registration_capacity = 1
    event.waitlist_enabled = False
    event.registration_open = True
    event.save()
    event_id = event.pk

    def attempt(index):
        connection.close()
        try:
            row = create_registration(
                Event.objects.get(pk=event_id),
                {
                    "request_id": uuid4(),
                    "participant_name": f"Seat {index}",
                    "email": f"seat{index}@example.com",
                    "consent": True,
                },
            )
            return row.status
        except (RegistrationFull, RegistrationDuplicate, RegistrationClosed):
            return "REJECTED"
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(attempt, range(8)))
    assert results.count("CONFIRMED") == 1, results
    assert EventRegistration.objects.filter(
        event_id=event_id, status=RegistrationStatus.CONFIRMED,
    ).count() == 1
