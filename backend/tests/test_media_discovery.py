"""Two-Site metadata discovery, fixed-dataset page boundaries and guarded edits."""
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from rest_framework.test import APIClient
from apps.audit.models import AuditEvent
from apps.media.models import MediaAsset
from apps.media.services import asset_write, update_asset
from .test_media_assets import media_world

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def discovery(media_world, monkeypatch):
    w = media_world
    stamp = datetime(2026, 11, 11, 12, 0, tzinfo=timezone.utc)
    monkeypatch.setattr("django.utils.timezone.now", lambda: stamp)
    def create(index, site, state="READY", mime="image/png", filename="Campus.PNG"):
        with asset_write(w.both, site.pk, "content.media.upload"):
            row = MediaAsset.objects.create(id=uuid.UUID(int=index), site=site,
                storage_reference=f"platform-private:sites/{site.pk}/discovery/{index}",
                original_filename=filename, detected_mime=mime, checksum="0"*64,
                byte_count=123, width=2 if mime.startswith("image/") else None,
                height=3 if mime.startswith("image/") else None, alt_text="Campus description",
                created_by=w.both, updated_by=w.both)
        if state == "ARCHIVED":
            update_asset(w.both, site.pk, row.pk, changes={"status": "READY"})
        if state != "PENDING":
            update_asset(w.both, site.pk, row.pk, changes={"status": state})
        return row
    w.images = [create(index, w.a) for index in range(1, 7)]
    w.pending = create(7, w.a, "PENDING")
    w.failed = create(8, w.a, "REJECTED")
    w.archived = create(9, w.a, "ARCHIVED")
    w.pdf = create(10, w.a, mime="application/pdf")
    w.literal = create(11, w.a, filename="literal%_report.png")
    w.foreign = [create(index, w.b) for index in range(101, 105)]
    w.client = APIClient(); w.client.force_authenticate(w.actor)
    w.root = f"/api/v1/sites/{w.a.pk}/assets/"
    return w


def test_ready_image_search_has_deterministic_two_site_page_boundary(discovery):
    w = discovery
    query = "?search=campus&ready_images=true&page_size=3&ordering=original_filename"
    first = w.client.get(w.root + query).json()
    second = w.client.get(w.root + query + "&page=2").json()
    expected = [str(row.pk) for row in w.images]
    assert first["count"] == second["count"] == 6
    assert [row["id"] for row in first["results"]] == expected[:3]
    assert [row["id"] for row in second["results"]] == expected[3:]
    assert first["next"] and second["previous"] and second["next"] is None
    assert w.client.get(w.root + query).json() == first
    assert len({row["id"] for row in first["results"] + second["results"]}) == 6
    assert all(row["site"] == w.a.pk and row["status"] == "READY" and row["content_type"] == "image/png" for row in first["results"] + second["results"])
    # The same timestamp also exercises the default -created_at,UUID ordering.
    default = w.client.get(w.root + "?search=campus&ready_images=true&page_size=100").json()
    assert [row["id"] for row in default["results"]] == expected
    assert w.client.get(f"/api/v1/sites/{w.b.pk}/assets/" + query).status_code == 403
    assert w.client.get(w.root + str(w.foreign[0].pk) + "/").status_code == 404
    path = os.environ.get("MEDIA_QUERY_EVIDENCE_PATH")
    if path:
        Path(path).write_text(json.dumps({"query": query, "site_a": w.a.pk, "site_b": w.b.pk,
            "same_filename": "Campus.PNG", "same_created_at": str(w.images[0].created_at),
            "expected_ids": expected, "excluded_ids": [str(x.pk) for x in [w.pending, w.failed, w.archived, w.pdf, *w.foreign]],
            "page_one": first, "page_two": second}, indent=2))


def test_filename_literals_status_and_type_filters_apply_before_paging(discovery):
    w = discovery
    for query, expected in (({"search": "%_"}, [w.literal]),
                            ({"search": "CAMpus", "status": "PENDING"}, [w.pending]),
                            ({"search": "campus", "type": "document"}, [w.pdf]),
                            ({"content_type": "application/pdf", "status": "READY"}, [w.pdf])):
        response = w.client.get(w.root, query)
        assert response.status_code == 200, response.content
        assert [r["id"] for r in response.json()["results"]] == [str(row.pk) for row in expected]
    first = w.client.get(w.root, {"page_size": 6}).json()
    second = w.client.get(w.root, {"page_size": 6, "page": 2}).json()
    assert first["count"] == second["count"] == 11
    assert len({r["id"] for r in first["results"] + second["results"]}) == 11
    assert w.client.get(w.root, {"type": "image", "status": "REJECTED"}).json()["results"][0]["id"] == str(w.failed.pk)


@pytest.mark.parametrize("query", ["page=0", "page_size=0", "page_size=101", "status=FAILED", "type=video", "ordering=site", "unknown=x", "status=READY&status=PENDING", "ready_images=true&status=PENDING", "ready_images=true&type=document", "ready_images=true&content_type=application/pdf", "content_type=IMAGE/PNG", "ready_images=maybe"])
def test_bad_or_contradictory_media_filters_fail_closed(media_world, query):
    w = media_world
    client = APIClient(); client.force_authenticate(w.actor)
    response = client.get(f"/api/v1/sites/{w.a.pk}/assets/?{query}")
    assert response.status_code == 400, response.content
    assert response.json()["error"]["code"] == "validation_error"


def test_metadata_edit_persists_and_readonly_attack_is_atomic(discovery):
    w = discovery; row = w.images[0]; path = w.root + str(row.pk) + "/"
    changed = w.client.patch(path, {"alt_text": "Accessible campus description"}, format="json")
    assert changed.status_code == 200, changed.content
    data = changed.json()
    assert data["alt_text"] == "Accessible campus description"
    assert data["thumbnail_status"] == "NOT_GENERATED" and data["content_type"] == "image/png"
    assert not {"storage_reference", "key", "bucket", "credentials"}.intersection(data)
    assert "platform-private" not in json.dumps(data)
    before = AuditEvent.objects.filter(entity_type="media.mediaasset", entity_id=str(row.pk)).count()
    invalid = w.client.patch(path, {"alt_text": "Must not persist", "site": w.b.pk, "byte_count": 999, "storage_reference": "forged-key"}, format="json")
    assert invalid.status_code == 400, invalid.content
    row.refresh_from_db()
    assert row.alt_text == "Accessible campus description" and row.site_id == w.a.pk and row.byte_count == 123
    assert row.storage_reference.endswith("/discovery/1")
    assert AuditEvent.objects.filter(entity_type="media.mediaasset", entity_id=str(row.pk)).count() == before
    foreign = w.client.patch(w.root + str(w.foreign[0].pk) + "/", {"alt_text": "Foreign edit"}, format="json")
    assert foreign.status_code == 404
    detail = w.client.get(path).json()
    assert detail == data
    assert w.client.get(w.root + str(w.pdf.pk) + "/").json()["thumbnail_status"] == "NOT_APPLICABLE"
    for field, value in {"id": str(uuid.uuid4()), "content_type": "text/plain", "detected_mime": "text/plain", "thumbnail_status": "READY", "original_filename": "changed.png", "checksum": "1"*64}.items():
        assert w.client.patch(path, {field: value}, format="json").status_code == 400
    assert w.client.patch(path, {"alt_text": "x"*1001}, format="json").status_code == 400
    assert w.client.get(path).json()["alt_text"] == "Accessible campus description"
    evidence = os.environ.get("MEDIA_MUTATION_EVIDENCE_PATH")
    if evidence:
        Path(evidence).write_text(json.dumps({"site_a": w.a.pk, "site_b": w.b.pk,
            "allowed_edit": data, "rejected_edit_status": invalid.status_code,
            "rejected_edit": invalid.json(), "foreign_edit_status": foreign.status_code,
            "detail_after_rejection": w.client.get(path).json()}, indent=2))
