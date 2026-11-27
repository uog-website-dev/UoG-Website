"""Event gallery: media ownership, publish, ordering, quarantine, IDOR."""
from contextlib import contextmanager
from datetime import timedelta
from uuid import uuid4
import hashlib
import io

import pytest
from django.utils import timezone

from apps.cms.event_gallery_models import EventGalleryImage
from apps.cms.event_models import Event, EventStatus
from apps.media.models import MediaAsset, MediaProcessing
from apps.media.services import _media_write_session
from apps.sites.models import Module, Site, SiteDomain
from apps.sites.services.lifecycle import activate_site
from apps.sites.services.modules import enable_module_for_site
from tests.test_site_appearance_api import owner, _site_admin_client  # noqa: F401

pytestmark = pytest.mark.django_db


def _enable_events(site):
    enable_module_for_site(site.pk, Module.objects.get(code="EVENTS").pk)


def _enable_media(site):
    for code, name in (("MEDIA", "Media"),):
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
        "title": "Gallery Summit",
        "slug": "gallery-summit",
        "summary": "Photos",
        "description": "<p>Photos</p>",
        "status": EventStatus.PUBLISHED,
        "published_at": timezone.now(),
        "starts_at": start,
        "ends_at": start + timedelta(hours=3),
        "timezone": "Africa/Addis_Ababa",
        "venue": "Hall",
    }
    payload.update(overrides)
    return Event.objects.create(**payload)


def _ready_image(site, user, *, name="photo.png"):
    from apps.media.processing import process_asset
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (64, 48), color=(20, 80, 120)).save(buffer, format="PNG")
    body = buffer.getvalue()

    class MemoryStorage:
        def __init__(self):
            self.objects = {}

        @contextmanager
        def open(self, bucket, key):
            yield io.BytesIO(self.objects[(bucket, key)])

        def put(self, bucket, key, data, content_type=None, cache_control=None):
            payload = data if isinstance(data, (bytes, bytearray)) else data.read()
            self.objects[(bucket, key)] = payload

    storage = MemoryStorage()
    reference = f"platform-private:sites/{site.pk}/uploads/{uuid4()}.png"
    bucket, key = reference.split(":", 1)
    storage.objects[(bucket, key)] = body
    with _media_write_session(user, site.pk):
        asset = MediaAsset.objects.create(
            site=site,
            storage_reference=reference,
            original_filename=name,
            detected_mime="image/png",
            byte_count=len(body),
            checksum=hashlib.sha256(body).hexdigest(),
            status="PENDING",
            width=64,
            height=48,
            alt_text="Campus courtyard",
            created_by=user,
            updated_by=user,
        )
        MediaProcessing.objects.create(asset=asset, state="QUEUED")
    asset = process_asset(asset.pk, storage=storage)
    assert asset.status == "READY" and asset.processing.state == "READY"
    return asset


def test_gallery_attach_publish_order_and_public_media(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site = Site.objects.create(code="EVT-GAL", name="Gallery Site", organization_unit=owner)
    activate_site(site.pk)
    SiteDomain.objects.create(site=site, hostname="evt-gal.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_events(site)
    _enable_media(site)
    actor = _site_admin_client(client, oidc, site)
    event = _event(site)
    first = _ready_image(site, actor, name="one.png")
    second = _ready_image(site, actor, name="two.png")
    base = f"/api/v1/sites/{site.pk}/events/{event.pk}/gallery/"

    created = client.post(
        base,
        {
            "items": [
                {
                    "media_asset": str(first.pk),
                    "caption": "Opening",
                    "alt_text": "Opening ceremony",
                    "usage_consent": True,
                    "is_published": True,
                },
                {
                    "media_asset": str(second.pk),
                    "caption": "Audience",
                    "alt_text": "Audience seated",
                    "usage_consent": True,
                    "is_published": False,
                },
            ],
        },
        content_type="application/json",
    )
    assert created.status_code == 201, created.content
    rows = created.json()
    assert len(rows) == 2
    assert rows[0]["is_published"] is True
    assert rows[1]["is_published"] is False
    draft_id = rows[1]["id"]
    published_id = rows[0]["id"]

    # Independent publish without Event republish.
    published = client.post(
        f"{base}{draft_id}/publish/",
        {"is_published": True, "version": rows[1]["version"]},
        content_type="application/json",
    )
    assert published.status_code == 200, published.content
    assert Event.objects.get(pk=event.pk).version == event.version

    detail = client.get(f"/api/v1/site-context/events/{event.slug}/", HTTP_HOST="evt-gal.uog.edu.et")
    assert detail.status_code == 200
    assert detail.json()["sections"]["gallery"] is True

    listed = client.get(
        f"/api/v1/site-context/events/{event.slug}/gallery/",
        HTTP_HOST="evt-gal.uog.edu.et",
    )
    assert listed.status_code == 200
    assert len(listed.json()) == 2
    assert listed.json()[0]["alt_text"] == "Opening ceremony"
    assert "media_asset" not in listed.json()[0]

    # Published gallery membership unlocks public media eligibility.
    from apps.media.delivery import is_event_public_media
    assert is_event_public_media(first) is True
    assert is_event_public_media(second) is True

    # Reorder with concurrency token.
    reordered = client.post(
        f"{base}reorder/",
        {
            "order": [draft_id, published_id],
            "versions": {
                draft_id: published.json()["version"],
                published_id: rows[0]["version"],
            },
        },
        content_type="application/json",
    )
    assert reordered.status_code == 200, reordered.content
    assert [row["id"] for row in reordered.json()] == [draft_id, published_id]

    # Unpublish hides from public list and media eligibility.
    client.post(
        f"{base}{draft_id}/publish/",
        {"is_published": False, "version": reordered.json()[0]["version"]},
        content_type="application/json",
    )
    listed_after = client.get(
        f"/api/v1/site-context/events/{event.slug}/gallery/",
        HTTP_HOST="evt-gal.uog.edu.et",
    )
    assert len(listed_after.json()) == 1
    assert listed_after.json()[0]["id"] == published_id
    assert is_event_public_media(second) is False
    assert is_event_public_media(first) is True

    # Detach retains media asset and revokes public eligibility.
    deleted = client.delete(f"{base}{published_id}/")
    assert deleted.status_code == 204
    assert MediaAsset.objects.filter(pk=first.pk).exists()
    assert EventGalleryImage.objects.get(pk=published_id).removed_at is not None
    assert is_event_public_media(first) is False


def test_gallery_idor_quarantine_and_consent(client, oidc, owner, settings):
    settings.DEBUG = True
    settings.ORGANIZATIONS_DEV_WRITES_ENABLED = True
    site_a = Site.objects.create(code="EVT-GA", name="Gal A", organization_unit=owner)
    site_b = Site.objects.create(code="EVT-GB", name="Gal B", organization_unit=owner)
    activate_site(site_a.pk)
    activate_site(site_b.pk)
    SiteDomain.objects.create(site=site_a, hostname="evt-ga.uog.edu.et", is_primary=True, status="ACTIVE")
    SiteDomain.objects.create(site=site_b, hostname="evt-gb.uog.edu.et", is_primary=True, status="ACTIVE")
    _enable_events(site_a)
    _enable_events(site_b)
    _enable_media(site_a)
    _enable_media(site_b)
    actor_a = _site_admin_client(client, oidc, site_a)
    event_a = _event(site_a, slug="gal-a", title="Gal A")
    event_b = _event(site_b, slug="gal-b", title="Gal B")
    local = _ready_image(site_a, actor_a, name="local.png")
    actor_b = _site_admin_client(client, oidc, site_b)
    foreign = _ready_image(site_b, actor_b, name="foreign.png")
    _site_admin_client(client, oidc, site_a)
    base = f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/gallery/"

    missing_consent = client.post(
        base,
        {"items": [{"media_asset": str(local.pk), "usage_consent": False, "alt_text": "x"}]},
        content_type="application/json",
    )
    assert missing_consent.status_code == 400

    foreign_attach = client.post(
        base,
        {"items": [{"media_asset": str(foreign.pk), "usage_consent": True, "alt_text": "stolen"}]},
        content_type="application/json",
    )
    assert foreign_attach.status_code == 400

    with _media_write_session(actor_a, site_a.pk):
        pending = MediaAsset.objects.create(
            site=site_a,
            storage_reference=f"platform-private:sites/{site_a.pk}/uploads/{uuid4()}.png",
            original_filename="pending.png",
            detected_mime="image/png",
            byte_count=10,
            checksum=hashlib.sha256(b"pending").hexdigest(),
            status="PENDING",
            created_by=actor_a,
            updated_by=actor_a,
        )
        MediaProcessing.objects.create(asset=pending, state="QUEUED")
    blocked = client.post(
        base,
        {"items": [{"media_asset": str(pending.pk), "usage_consent": True, "alt_text": "scan"}]},
        content_type="application/json",
    )
    assert blocked.status_code == 400

    created = client.post(
        base,
        {"items": [{"media_asset": str(local.pk), "usage_consent": True, "alt_text": "ok", "is_published": True}]},
        content_type="application/json",
    )
    assert created.status_code == 201
    image_id = created.json()[0]["id"]

    _site_admin_client(client, oidc, site_b)
    assert client.get(f"/api/v1/sites/{site_a.pk}/events/{event_a.pk}/gallery/").status_code in {403, 404}
    assert client.get(
        f"/api/v1/sites/{site_b.pk}/events/{event_b.pk}/gallery/{image_id}/",
    ).status_code in {403, 404, 405}

    # Unpublished / detached assets are not publicly downloadable via gallery eligibility.
    _site_admin_client(client, oidc, site_a)
    client.post(
        f"{base}{image_id}/publish/",
        {"is_published": False, "version": created.json()[0]["version"]},
        content_type="application/json",
    )
    media = client.get(
        f"/api/v1/site-context/media/{local.pk}/?variant=display",
        HTTP_HOST="evt-ga.uog.edu.et",
    )
    assert media.status_code == 404
