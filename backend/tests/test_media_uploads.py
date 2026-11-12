"""Upload gate, bounded streaming, retry, worker->picker and MinIO integration."""
import io
import os
import uuid
from contextlib import contextmanager
from datetime import timedelta

import pytest
from django.core.exceptions import PermissionDenied, ValidationError
from django.utils import timezone
from django.db import IntegrityError
from rest_framework.test import APIClient
from PIL import Image
from pypdf import PdfWriter

from .test_media_assets import media_world
from apps.media.models import MediaAsset, MediaUpload, MediaUploadAttempt
from apps.media.uploads import upload_asset, process_asset, reconcile_attempts, inspect_upload, UploadTooLarge, StorageUnavailable, UploadBusy
from apps.media.uploads import enqueue as actual_enqueue
from apps.media.services import update_asset, attach_asset, asset_write
from apps.cms.blocks import check_image_ref, Rejection
from apps.cms.services.pages import create_page
from apps.sites.models import Module

pytestmark = pytest.mark.django_db(transaction=True)


def png():
    stream = io.BytesIO()
    Image.new("RGB", (2, 3), "red").save(stream, format="PNG")
    return stream.getvalue()


class MemoryStorage:
    def __init__(self):
        self.objects = {}
        self.fail_put = False
        self.fail_delete = False
    def put(self, bucket, key, stream, **kwargs):
        self.objects[(bucket, key)] = stream.read()
        if self.fail_put:
            raise OSError("interrupted write")
    def delete(self, bucket, key):
        if self.fail_delete:
            raise OSError("delete unavailable")
        self.objects.pop((bucket, key), None)
    @contextmanager
    def open(self, bucket, key):
        yield io.BytesIO(self.objects[(bucket, key)])


@pytest.fixture
def storage(monkeypatch):
    result = MemoryStorage()
    monkeypatch.setattr("apps.media.api.upload_asset", lambda *args, **kwargs: upload_asset(*args, **kwargs, storage=result))
    monkeypatch.setattr("apps.media.uploads.enqueue", lambda _: None)
    monkeypatch.setattr("apps.media.uploads.ObjectStorage", lambda: result)
    return result


def upload(world, storage, key=None):
    return upload_asset(world.actor, world.a.pk, io.BytesIO(png()), filename="campus.png", request_key=key or uuid.uuid4(), storage=storage)


def test_upload_processing_worker_and_ready_picker_have_one_identity(media_world, storage):
    w = media_world
    client = APIClient(); client.force_authenticate(w.actor)
    key = str(uuid.uuid4())
    root = f"/api/v1/sites/{w.a.pk}/assets/"
    response = client.generic("POST", root + "upload/?filename=campus.png", png(), content_type="image/fake", HTTP_IDEMPOTENCY_KEY=key)
    assert response.status_code == 202, response.content
    data = response.json()
    assert data["status"] == "PENDING" and data["processing_state"] == "PROCESSING"
    assert data["detected_mime"] == "image/png" and "storage_reference" not in data
    assert client.get(root + "?status=READY").json()["results"] == []
    assert len(client.get(root).json()["results"]) == 1
    asset = MediaAsset.objects.get(pk=data["id"])
    assert asset.storage_reference.startswith(f"platform-private:sites/{w.a.pk}/uploads/")
    with pytest.raises(ValidationError):
        update_asset(w.actor, w.a.pk, asset.pk, changes={"status": "READY"})
    with pytest.raises(IntegrityError):
        with asset_write(w.actor, w.a.pk, "content.media.upload"):
            MediaAsset.objects.filter(pk=asset.pk).update(status="READY")
    page = create_page(site=w.a, title="Pick", slug="pick", actor=w.actor)
    revision = page.revisions.latest("revision_number")
    with pytest.raises(ValidationError):
        attach_asset(w.actor, w.a.pk, asset_id=asset.pk, page_revision_id=revision.pk, node_id="slider", field_path="image")
    ref = f"sites/{w.a.pk}/assets/{asset.pk}"
    with pytest.raises(Rejection):
        check_image_ref(ref, site_id=w.a.pk)
    from apps.media.tasks import process_media_asset
    process_media_asset.run(str(asset.pk))
    assert check_image_ref(ref, site_id=w.a.pk) == ref
    ready = client.get(root + "?status=READY").json()["results"]
    assert [a["id"] for a in ready] == [data["id"]]
    assert ready[0]["processing_state"] == "READY"
    for node in ("slider", "gallery"):
        attach_asset(w.actor, w.a.pk, asset_id=asset.pk, page_revision_id=revision.pk, node_id=node, field_path="image")
    replay = client.generic("POST", root + "upload/?filename=campus.png", png(), content_type="application/octet-stream", HTTP_IDEMPOTENCY_KEY=key)
    assert replay.status_code == 202 and replay.json()["id"] == data["id"]
    assert MediaAsset.objects.count() == 1 and MediaUploadAttempt.objects.count() == 1
    process_asset(asset.pk, storage=storage)
    assert MediaAsset.objects.count() == 1


def test_interrupted_write_retry_and_cleanup_cannot_delete_success(media_world, storage):
    w = media_world; key = uuid.uuid4()
    storage.fail_put = storage.fail_delete = True
    with pytest.raises(StorageUnavailable):
        upload(w, storage, key)
    assert not MediaAsset.objects.exists()
    abandoned = MediaUploadAttempt.objects.get()
    storage.fail_put = storage.fail_delete = False
    asset = upload(w, storage, key)
    MediaUploadAttempt.objects.filter(pk=abandoned.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
    assert reconcile_attempts(storage=storage) == 1
    assert len(storage.objects) == 1
    assert asset.storage_reference.split(":", 1)[1] in [k for _, k in storage.objects]
    process_asset(asset.pk, storage=storage)
    reconcile_attempts(storage=storage)
    assert MediaAsset.objects.get().status == "READY" and len(storage.objects) == 3


def test_transfer_lease_blocks_parallel_retry_and_expired_attempt_can_be_reconciled(media_world, storage):
    w = media_world; key = uuid.uuid4()
    session = MediaUpload.objects.create(site=w.a, creator=w.actor, request_key=key, original_filename="campus.png")
    attempt = session.attempts.create(storage_reference=f"platform-private:sites/{w.a.pk}/uploads/{uuid.uuid4()}", expires_at=timezone.now()+timedelta(minutes=1))
    with pytest.raises(UploadBusy):
        upload(w, storage, key)
    attempt.expires_at = timezone.now() - timedelta(seconds=1); attempt.save()
    asset = upload(w, storage, key)
    reconcile_attempts(storage=storage)
    assert asset.pk and len(storage.objects) == 1


def test_stream_limit_is_enforced_even_when_length_is_untrusted(media_world, storage, settings):
    settings.MEDIA_UPLOAD_MAX_BYTES = 8
    class Stream:
        consumed = 0
        def read(self, n):
            self.consumed += n
            return b"x" * n
    stream = Stream()
    with pytest.raises(UploadTooLarge):
        upload_asset(media_world.actor, media_world.a.pk, stream, filename="big.txt", request_key=uuid.uuid4(), storage=storage)
    assert stream.consumed == 9
    assert not MediaAsset.objects.exists() and not storage.objects


def test_http_rejects_forged_bytes_oversize_paths_and_unauthorized_requests(media_world, storage, settings):
    w = media_world; client = APIClient(); root = f"/api/v1/sites/{w.a.pk}/assets/upload/"
    def post(body, suffix="?filename=x.png"):
        return client.generic("POST", root+suffix, body, content_type="image/png", HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()))
    assert post(png()).status_code == 401
    client.force_authenticate(w.actor)
    foreign = client.generic("POST", f"/api/v1/sites/{w.b.pk}/assets/upload/?filename=x.png", png(), content_type="application/octet-stream", HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()))
    assert foreign.status_code == 403
    bad = post(b'<svg onload="evil()"></svg>')
    assert bad.status_code == 400 and bad.json()["error"]["code"]
    assert post(png(), "?filename=x.png&storage_reference=evil").status_code == 400
    settings.MEDIA_UPLOAD_MAX_BYTES = 2
    too_large = post(png())
    assert too_large.status_code == 413 and too_large.json()["error"]["code"] == "upload_too_large"
    Module.objects.filter(code="MEDIA").update(is_enabled=False)
    assert post(png()).status_code == 403
    assert not MediaAsset.objects.exists() and not storage.objects


def test_gate_precedes_stream_read(media_world, storage):
    class Unreadable:
        def read(self, _):
            raise AssertionError("Unauthorized body was read")
    with pytest.raises(PermissionDenied):
        upload_asset(media_world.actor, media_world.b.pk, Unreadable(), filename="x.png", request_key=uuid.uuid4(), storage=storage)


def test_pdf_text_and_image_validation_and_active_pdf_rejection(settings):
    writer = PdfWriter(); writer.add_blank_page(width=100, height=100)
    pdf = io.BytesIO(); writer.write(pdf)
    for body, mime in ((pdf.getvalue(), "application/pdf"), (b"University report", "text/plain"), (png(), "image/png")):
        with io.BytesIO() as spool:
            assert inspect_upload(io.BytesIO(body), spool)["detected_mime"] == mime
    from pypdf.generic import NameObject, DictionaryObject, TextStringObject
    writer.root_object[NameObject("/OpenAction")] = DictionaryObject({NameObject("/S"): NameObject("/JavaScript"), NameObject("/JS"): TextStringObject("app.alert(1)")})
    malicious = io.BytesIO(); writer.write(malicious)
    for body in (malicious.getvalue(), b"%PDF-1.7 malformed", b"MZ executable", b"<html>unsafe</html>", b"\x89PNG\r\n\x1a\ncorrupt"):
        with pytest.raises(ValidationError), io.BytesIO() as spool:
            inspect_upload(io.BytesIO(body), spool)
    settings.MEDIA_TEXT_MAX_BYTES = 2
    with pytest.raises(UploadTooLarge), io.BytesIO() as spool:
        inspect_upload(io.BytesIO(b"text"), spool)


def test_worker_detects_object_tampering_and_never_exposes_ready(media_world, storage):
    asset = upload(media_world, storage)
    storage.objects[tuple(asset.storage_reference.split(":", 1))] = b"different bytes"
    assert process_asset(asset.pk, storage=storage).status == "REJECTED"
    assert not MediaAsset.objects.filter(status="READY").exists()


@pytest.mark.skipif(os.environ.get("RUN_MEDIA_MINIO_TESTS") != "1", reason="Requires local private MinIO integration environment")
def test_real_private_minio_interrupted_put_retry_worker_and_cleanup(media_world, monkeypatch, settings):
    from apps.media.storage import ObjectStorage
    from urllib.request import urlopen
    from urllib.error import HTTPError
    monkeypatch.setattr("apps.media.uploads.enqueue", lambda _: None)
    real = ObjectStorage()
    class FaultStorage:
        fail = True
        def put(self, bucket, key, stream, **kwargs):
            real.put(bucket, key, stream, **kwargs)
            if self.fail:
                raise OSError("Lost response after MinIO committed PUT")
        def delete(self, bucket, key):
            if self.fail:
                raise OSError("Cleanup temporarily unavailable")
            real.delete(bucket, key)
    faulty = FaultStorage(); w = media_world; request_key = uuid.uuid4()
    try:
        with pytest.raises(StorageUnavailable):
            upload(w, faulty, request_key)
        assert not MediaAsset.objects.exists()
        faulty.fail = False
        asset = upload(w, faulty, request_key)
        MediaUploadAttempt.objects.exclude(state="STORED").update(expires_at=timezone.now()-timedelta(seconds=1))
        reconcile_attempts(storage=real)
        assert process_asset(asset.pk, storage=real).status == "READY"
        bucket, key = asset.storage_reference.split(":", 1)
        with pytest.raises(HTTPError) as denied:
            urlopen(f"{settings.AWS_S3_ENDPOINT_URL}/{bucket}/{key}")
        assert denied.value.code == 403
        assert MediaAsset.objects.count() == 1
        failed = MediaUploadAttempt.objects.get(state="FAILED")
        from django.http import Http404
        with pytest.raises(Http404), real.open(*failed.storage_reference.split(":", 1)):
            pass
    finally:
        from apps.media.models import MediaDerivative
        for reference in MediaDerivative.objects.values_list("storage_reference", flat=True):
            real.delete(*reference.split(":", 1))
        for reference in MediaUploadAttempt.objects.values_list("storage_reference", flat=True):
            real.delete(*reference.split(":", 1))


def test_truncated_transfer_never_reaches_storage(media_world, storage):
    with pytest.raises(ValidationError, match="incomplete"):
        upload_asset(media_world.actor, media_world.a.pk, io.BytesIO(png()), filename="campus.png", request_key=uuid.uuid4(), storage=storage, expected_length=len(png())+10)
    assert not MediaAsset.objects.exists() and not storage.objects


def test_site_editor_can_enter_own_workspace_and_upload_but_not_archive(media_world, storage):
    from apps.authorization.models import UserRoleAssignment, Role
    from django.core.management import call_command
    call_command("seed_rbac", verbosity=0)
    w = media_world
    UserRoleAssignment.objects.filter(user=w.actor).delete()
    UserRoleAssignment.objects.create(user=w.actor, role=Role.objects.get(code="editor"), scope="SITE", site=w.a, organization=w.a.organization_unit)
    client = APIClient(); client.force_authenticate(w.actor)
    assert client.get(f"/api/v1/sites/{w.a.pk}/").status_code == 200
    assert client.get(f"/api/v1/sites/{w.a.pk}/modules/").status_code == 200
    asset = upload(w, storage)
    assert process_asset(asset.pk, storage=storage).status == "READY"
    with pytest.raises(PermissionDenied):
        update_asset(w.actor, w.a.pk, asset.pk, changes={"status": "ARCHIVED"})
    assert client.get(f"/api/v1/sites/{w.b.pk}/assets/").status_code == 403


def test_lost_database_commit_response_does_not_delete_committed_object(media_world, storage, monkeypatch):
    from contextlib import contextmanager
    from apps.media import uploads
    original = uploads.asset_write
    calls = 0
    @contextmanager
    def uncertain(*args, **kwargs):
        nonlocal calls
        calls += 1
        with original(*args, **kwargs):
            yield
        if calls == 2:
            raise OSError("Commit response lost after commit")
    monkeypatch.setattr(uploads, "asset_write", uncertain)
    key = uuid.uuid4()
    with pytest.raises(OSError):
        upload(media_world, storage, key)
    assert MediaAsset.objects.count() == 1 and len(storage.objects) == 1
    asset = upload(media_world, storage, key)
    assert process_asset(asset.pk, storage=storage).status == "READY"
    assert len(storage.objects) == 3


@pytest.mark.parametrize("format", ["PNG", "JPEG", "WEBP"])
def test_supported_image_decoders_and_pixel_limit(format, settings):
    stream = io.BytesIO()
    Image.new("RGB", (2, 3)).save(stream, format=format)
    with io.BytesIO() as output:
        metadata = inspect_upload(io.BytesIO(stream.getvalue()), output)
    assert metadata["detected_mime"] == {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}[format]
    assert (metadata["width"], metadata["height"]) == (2, 3)
    settings.MEDIA_IMAGE_MAX_PIXELS = 1
    with pytest.raises(ValidationError), io.BytesIO() as output:
        inspect_upload(io.BytesIO(stream.getvalue()), output)


def test_broker_failure_keeps_durable_pending_upload_for_reconciliation(media_world, storage, monkeypatch):
    from apps.media import uploads, tasks
    # Restore the actual dispatcher hidden by the deterministic storage fixture.
    monkeypatch.setattr(uploads, "enqueue", actual_enqueue)
    monkeypatch.setattr(uploads, "ObjectStorage", lambda: storage)
    monkeypatch.setattr(tasks.process_media_asset, "delay", lambda _: (_ for _ in ()).throw(OSError("broker unavailable")))
    asset = upload(media_world, storage)
    asset.refresh_from_db()
    assert asset.status == "PENDING" and MediaUpload.objects.get().asset_id == asset.pk
    monkeypatch.setattr(tasks.process_media_asset, "delay", lambda asset_id: tasks.process_media_asset.run(asset_id))
    tasks.reconcile_uploads.run()
    asset.refresh_from_db()
    assert asset.status == "READY" and MediaAsset.objects.count() == 1
