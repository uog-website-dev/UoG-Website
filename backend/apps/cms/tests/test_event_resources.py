"""Event resources: attach documents, visibility, entitlement, IDOR, quarantine."""
from contextlib import contextmanager
from datetime import timedelta
from uuid import uuid4
import hashlib
import io

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.cms.event_models import Event, EventStatus
from apps.cms.event_registration_models import EventRegistration, RegistrationStatus
from apps.cms.event_resource_models import EventResource, ResourceVisibility
from apps.cms.event_session_models import EventSession
from apps.cms.models import Document
from apps.media.models import MediaAsset, MediaProcessing
from apps.media.services import _media_write_session
from apps.sites.models import Module, Site, SiteDomain
from apps.sites.services.lifecycle import activate_site
from apps.sites.services.modules import enable_module_for_site
from tests.test_site_appearance_api import owner, _site_admin_client  # noqa: F401

pytestmark = pytest.mark.django_db


def _enable_events(site):
    enable_module_for_site(site.pk, Module.objects.get(code="EVENTS").pk)


def _enable_documents(site):
    for code, name in (("MEDIA", "Media"), ("DOCUMENTS", "Documents")):
        module, _ = Module.objects.get_or_create(
            code=code,
            defaults={"name": name, "description": name, "status": "IMPLEMENTED", "is_enabled": True},
        )
        if module.status != "IMPLEMENTED" or not module.is_enabled:
            module.status = "IMPLEMENTED"
            module.is_enabled = True
            module.save(update_fields=["status", "is_enabled"])
        enable_module_for_site(site.pk, module.pk)


def _event(site, **overrides):
    start = timezone.now() + timedelta(days=1)
    payload = {
        "site": site,
        "title": "Resource Summit",
        "slug": "resource-summit",
        "summary": "Files",
        "description": "<p>Files</p>",
        "status": EventStatus.PUBLISHED,
        "published_at": timezone.now(),
        "starts_at": start,
        "ends_at": start + timedelta(hours=4),
        "timezone": "Africa/Addis_Ababa",
        "venue": "Hall",
        "registration_required": True,
        "registration_open": True,
        "registration_capacity": 50,
    }
    payload.update(overrides)
    return Event.objects.create(**payload)


def _session(event):
    return EventSession.objects.create(
        event=event,
        day_date=event.starts_at.date(),
        starts_at=event.starts_at,
        ends_at=event.starts_at + timedelta(hours=1),
        title="Keynote",
        sort_order=0,
    )


def _ready_document(site, user, *, title="Brochure", filename="brochure.pdf"):
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
            original_filename=filename,
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
    return document, asset, body, key


def test_attach_publish_public_download_and_session_resource(client, oidc, owner, settings, monkeypatch):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="EVT-RES", name="Resource Site", organization_unit=owner)
    activate_site(site.pk)
    SiteDomain.objects.create(site=site, hostname="evt-res.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_events(site)
    _enable_documents(site)
    actor = _site_admin_client(client, oidc, site)
    event = _event(site)
    session = _session(event)
    brochure, asset, body, key = _ready_document(site, actor, title="Event Brochure")
    slides, _slides_asset, slides_body, slides_key = _ready_document(
        site, actor, title="Session Slides", filename="slides.pdf",
    )

    bodies = {key: body, slides_key: slides_body}

    @contextmanager
    def open_object(self, bucket, object_key):
        yield io.BytesIO(bodies[object_key])

    monkeypatch.setattr("apps.media.storage.ObjectStorage.open", open_object)

    base = f"/api/v1/sites/{site.pk}/events/{event.pk}/resources/"
    created = client.post(
        base,
        {
            "document": str(brochure.pk),
            "title": "Official brochure",
            "category": "BROCHURE",
            "visibility": "PUBLIC",
        },
        content_type="application/json",
    )
    assert created.status_code == 201, created.content
    brochure_id = created.json()["id"]
    assert created.json()["visibility"] == "PUBLIC"
    assert Document.objects.filter(pk=brochure.pk).exists()

    session_res = client.post(
        base,
        {
            "document": str(slides.pk),
            "title": "Keynote slides",
            "category": "SLIDES",
            "session": str(session.pk),
            "visibility": "DRAFT",
        },
        content_type="application/json",
    )
    assert session_res.status_code == 201, session_res.content
    slides_id = session_res.json()["id"]
    assert session_res.json()["session"] == str(session.pk)

    # Independent publish without republishing Event.
    published = client.post(
        f"{base}{slides_id}/visibility/",
        {"visibility": "PUBLIC"},
        content_type="application/json",
    )
    assert published.status_code == 200
    assert Event.objects.get(pk=event.pk).version == event.version

    detail = client.get(f"/api/v1/site-context/events/{event.slug}/", HTTP_HOST="evt-res.uog.edu.et")
    assert detail.status_code == 200
    assert detail.json()["sections"]["resources"] is True

    listed = client.get(
        f"/api/v1/site-context/events/{event.slug}/resources/",
        HTTP_HOST="evt-res.uog.edu.et",
    )
    assert listed.status_code == 200
    assert len(listed.json()) == 2
    assert "document" not in listed.json()[0]

    file_resp = client.get(
        f"/api/v1/site-context/events/{event.slug}/resources/{brochure_id}/file/?inline=1",
        HTTP_HOST="evt-res.uog.edu.et",
    )
    assert file_resp.status_code == 200
    assert b"".join(file_resp.streaming_content) == body
    assert file_resp["Content-Type"] == "application/pdf"
    assert "inline" in file_resp["Content-Disposition"]
    assert "no-store" in file_resp["Cache-Control"]

    # Soft-remove association retains Document.
    deleted = client.delete(f"{base}{brochure_id}/")
    assert deleted.status_code == 204
    assert Document.objects.filter(pk=brochure.pk).exists()
    assert EventResource.objects.get(pk=brochure_id).removed_at is not None
    assert client.get(
        f"/api/v1/site-context/events/{event.slug}/resources/{brochure_id}/file/",
        HTTP_HOST="evt-res.uog.edu.et",
    ).status_code == 404


def test_registered_only_entitlement_grant_expiry_and_idor(client, oidc, owner, settings, monkeypatch):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site_a = Site.objects.create(code="EVT-RA", name="Res A", organization_unit=owner)
    site_b = Site.objects.create(code="EVT-RB", name="Res B", organization_unit=owner)
    activate_site(site_a.pk)
    activate_site(site_b.pk)
    SiteDomain.objects.create(site=site_a, hostname="evt-ra.uog.edu.et", is_primary=True, status="ACTIVE")
    SiteDomain.objects.create(site=site_b, hostname="evt-rb.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_events(site_a)
    _enable_events(site_b)
    _enable_documents(site_a)
    _enable_documents(site_b)
    actor_a = _site_admin_client(client, oidc, site_a)
    event_a = _event(site_a, slug="summit-a", title="Summit A")
    event_b = _event(site_b, slug="summit-b", title="Summit B")
    doc_a, asset_a, body, key = _ready_document(site_a, actor_a, title="Private Pack")
    actor_b = _site_admin_client(client, oidc, site_b)
    doc_b, _asset_b, _body_b, _key_b = _ready_document(site_b, actor_b, title="Other Site Doc")
    _site_admin_client(client, oidc, site_a)

    @contextmanager
    def open_object(self, bucket, object_key):
        yield io.BytesIO(body)

    monkeypatch.setattr("apps.media.storage.ObjectStorage.open", open_object)

    base_a = f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/resources/"
    created = client.post(
        base_a,
        {
            "document": str(doc_a.pk),
            "title": "Registrant pack",
            "visibility": "REGISTERED_ONLY",
            "category": "HANDOUT",
        },
        content_type="application/json",
    )
    assert created.status_code == 201, created.content
    resource_id = created.json()["id"]

    # Cannot attach another Site's document.
    _site_admin_client(client, oidc, site_a)
    foreign = client.post(
        base_a,
        {"document": str(doc_b.pk), "title": "Stolen", "visibility": "PUBLIC"},
        content_type="application/json",
    )
    assert foreign.status_code == 400

    # Anonymous cannot download registered-only.
    anon = client.get(
        f"/api/v1/site-context/events/{event_a.slug}/resources/{resource_id}/file/",
        HTTP_HOST="evt-ra.uog.edu.et",
    )
    assert anon.status_code in {401, 403}

    registration = EventRegistration.objects.create(
        event=event_a,
        site=site_a,
        request_id=uuid4(),
        email="reg@example.com",
        email_normalized="reg@example.com",
        participant_name="Reg User",
        status=RegistrationStatus.CONFIRMED,
        consent_at=timezone.now(),
        confirmed_at=timezone.now(),
    )

    grant = client.post(
        f"/api/v1/site-context/events/{event_a.slug}/resources/{resource_id}/entitlement/",
        {"email": "reg@example.com", "token": registration.management_token},
        content_type="application/json",
        HTTP_HOST="evt-ra.uog.edu.et",
    )
    assert grant.status_code == 200, grant.content
    token = grant.json()["grant"]
    download = client.get(
        f"/api/v1/site-context/events/{event_a.slug}/resources/{resource_id}/file/?grant={token}",
        HTTP_HOST="evt-ra.uog.edu.et",
    )
    assert download.status_code == 200
    assert b"".join(download.streaming_content) == body

    # Unpublish revokes future access even with old grant.
    _site_admin_client(client, oidc, site_a)
    client.post(
        f"{base_a}{resource_id}/visibility/",
        {"visibility": "DRAFT"},
        content_type="application/json",
    )
    revoked = client.get(
        f"/api/v1/site-context/events/{event_a.slug}/resources/{resource_id}/file/?grant={token}",
        HTTP_HOST="evt-ra.uog.edu.et",
    )
    assert revoked.status_code == 404

    # Cross-site IDOR
    _site_admin_client(client, oidc, site_b)
    assert client.get(
        f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/resources/",
    ).status_code in {403, 404}
    assert client.get(
        f"/api/v1/sites/{site_b.pk}/events/{event_b.pk}/resources/{resource_id}/file/",
    ).status_code == 404

    # Quarantined / not ready cannot be attached (scan gate).
    _site_admin_client(client, oidc, site_a)
    client.delete(f"{base_a}{resource_id}/")
    from django.core.exceptions import ValidationError as DjangoValidationError

    def quarantine(*args, **kwargs):
        raise DjangoValidationError({
            "file_reference": "Wait for the security scan to finish before attaching this file.",
        })

    monkeypatch.setattr("apps.cms.event_resource_domain.validate_document_file", quarantine)
    blocked = client.post(
        base_a,
        {"document": str(doc_a.pk), "title": "Not ready", "visibility": "PUBLIC"},
        content_type="application/json",
    )
    assert blocked.status_code == 400
    assert asset_a.status == "READY"
