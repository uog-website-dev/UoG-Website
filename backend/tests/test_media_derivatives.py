"""Image jobs: duplicate delivery, retry exhaustion and scoped fallback bytes."""
import io
import os
import json
from pathlib import Path
import uuid
from contextlib import contextmanager
from datetime import timedelta

import pytest
from celery.exceptions import Retry
from django.contrib.auth import get_user_model
from django.http import Http404
from django.test import Client
from django.utils import timezone
from rest_framework.test import APIClient
from PIL import Image

from .test_media_assets import media_world
from .test_media_uploads import MemoryStorage, png
from apps.media.models import MediaAsset, MediaProcessing, MediaDerivative
from apps.media.uploads import upload_asset, process_asset
from apps.media import processing, tasks
from apps.media.services import update_asset, register_asset
from apps.cms.services.pages import create_page
from apps.cms.tests.support import transition_with_site_role
from apps.sites.models import SiteDomain
from apps.sites.services.lifecycle import activate_site, archive_site

pytestmark = pytest.mark.django_db(transaction=True)


class DerivativeStorage(MemoryStorage):
    def __init__(self):
        super().__init__()
        self.writes = []
        self.fail_derivatives = False
    def put(self, bucket, key, stream, **kwargs):
        self.writes.append((bucket,key))
        super().put(bucket, key, stream, **kwargs)
        if self.fail_derivatives and "/derivatives/" in key:
            raise OSError("private provider failure must not be serialized")
    @contextmanager
    def open(self, bucket, key):
        if (bucket,key) not in self.objects:
            raise Http404("Missing object")
        yield io.BytesIO(self.objects[(bucket,key)])


@pytest.fixture
def derivative_storage(monkeypatch):
    storage = DerivativeStorage()
    monkeypatch.setattr("apps.media.uploads.ObjectStorage", lambda: storage)
    monkeypatch.setattr("apps.media.delivery.ObjectStorage", lambda: storage)
    monkeypatch.setattr("apps.media.uploads.enqueue", lambda _: None)
    return storage


def upload(w, storage, site=None, actor=None):
    return upload_asset(actor or w.actor, (site or w.a).pk, io.BytesIO(png()), filename="campus.png", request_key=uuid.uuid4(), storage=storage)


def client(w):
    result = APIClient(); result.force_authenticate(w.actor)
    return result


def test_duplicate_job_produces_one_of_each_deterministic_variant(media_world, derivative_storage):
    w=media_world; storage=derivative_storage
    asset=upload(w,storage)
    assert MediaProcessing.objects.get(asset=asset).state == "QUEUED"
    tasks.process_media_asset.run(str(asset.pk))
    first = list(MediaDerivative.objects.filter(asset=asset).order_by("variant").values())
    assert len(first)==2
    keys = [row["storage_reference"] for row in first]
    assert all(str(asset.pk) in key and asset.checksum in key and "webp-v1" in key for key in keys)
    writes=len(storage.writes)
    tasks.process_media_asset.run(str(asset.pk))
    assert list(MediaDerivative.objects.filter(asset=asset).order_by("variant").values()) == first
    assert len(storage.writes)==writes and MediaProcessing.objects.get(asset=asset).attempts==1
    asset.refresh_from_db(); assert asset.status=="READY"
    payload=client(w).get(f"/api/v1/sites/{w.a.pk}/assets/{asset.pk}/").json()
    assert payload["thumbnail_status"]=="READY" and payload["thumbnail_url"]
    assert "platform-private" not in str(payload)
    for row in first:
        with Image.open(io.BytesIO(storage.objects[tuple(row["storage_reference"].split(":",1))])) as image:
            assert image.format=="WEBP" and max(image.size)<=processing.VARIANTS[row["variant"]]


def test_celery_retries_stop_at_durable_budget_and_report_terminal_failure(media_world, derivative_storage, settings, monkeypatch):
    w=media_world; storage=derivative_storage
    settings.MEDIA_PROCESSING_MAX_ATTEMPTS=3
    settings.MEDIA_PROCESSING_RETRY_SECONDS=0
    asset=upload(w,storage); storage.fail_derivatives=True
    calls=[]
    def retry(**kwargs):
        calls.append(kwargs)
        raise Retry()
    monkeypatch.setattr(tasks.process_media_asset,"retry",retry)
    for _ in range(2):
        with pytest.raises(Retry): tasks.process_media_asset.run(str(asset.pk))
    tasks.process_media_asset.run(str(asset.pk))
    writes=len(storage.writes)
    tasks.process_media_asset.run(str(asset.pk))
    job=MediaProcessing.objects.get(asset=asset)
    assert job.state=="FAILED" and job.attempts==3 and job.failure_code=="PROCESSING_IO"
    assert len(calls)==2 and all(call["max_retries"]==2 for call in calls)
    assert len(storage.writes)==writes and not MediaDerivative.objects.filter(asset=asset).exists()
    api=client(w); root=f"/api/v1/sites/{w.a.pk}/assets/"
    data=api.get(root+str(asset.pk)+"/").json()
    assert data["status"]=="REJECTED" and data["processing_state"]=="FAILED" and data["thumbnail_status"]=="FAILED"
    assert data["processing_attempts"]==3 and data["thumbnail_url"] is None
    assert "provider" not in str(data)
    assert api.get(root+"?ready_images=true").json()["results"]==[]
    assert api.get(root+str(asset.pk)+"/image/").status_code==404
    # Beat recovery must not reset or redispatch a terminal attempt budget.
    dispatched=[]; monkeypatch.setattr("apps.media.uploads.enqueue",dispatched.append)
    tasks.reconcile_uploads.run()
    assert dispatched==[]
    from django.db import IntegrityError
    with pytest.raises(IntegrityError):
        with processing.processing_write(asset):
            MediaProcessing.objects.filter(asset=asset).update(state="QUEUED",attempts=0)
    with pytest.raises(IntegrityError):
        with processing.processing_write(asset):
            MediaProcessing.objects.filter(asset=asset).delete()
    assert MediaProcessing.objects.get(asset=asset).attempts==3


@pytest.mark.parametrize("fault",["corrupt","pixels"])
def test_invalid_original_is_terminal_and_never_selectable(media_world, derivative_storage, settings, fault):
    w=media_world; storage=derivative_storage; asset=upload(w,storage)
    if fault=="corrupt": storage.objects[tuple(asset.storage_reference.split(":",1))]=b"\x89PNG\r\n\x1a\ncorrupt"
    else: settings.MEDIA_IMAGE_MAX_PIXELS=1
    process_asset(asset.pk,storage=storage)
    job=MediaProcessing.objects.get(asset=asset)
    assert job.state=="FAILED" and job.attempts==1 and job.failure_code=="INVALID_IMAGE"
    process_asset(asset.pk,storage=storage)
    assert MediaProcessing.objects.get(asset=asset).attempts==1
    assert not MediaDerivative.objects.exists()


def _publish(w,asset):
    page=create_page(site=w.a,title="Published media",slug="published-media",actor=w.both,
        blocks=[{"type":"section","heading":"Photos","children":[{"type":"image","ref":f"sites/{w.a.pk}/assets/{asset.pk}","alt":"Campus"}]}])
    for action in ("submit","approve","publish"):
        actor=get_user_model().objects.create_user(username=f"thumbnail-{action}")
        transition_with_site_role(page,action,actor)
    return page


def test_missing_derivative_private_and_public_routes_use_scoped_verified_fallback(media_world, derivative_storage, settings):
    w=media_world; storage=derivative_storage
    settings.ALLOWED_HOSTS=["testserver",".uog.edu.et"]
    activate_site(w.a.pk); activate_site(w.b.pk)
    for site,name in ((w.a,"thumb-a"),(w.b,"thumb-b")):
        SiteDomain.objects.create(site=site,hostname=f"{name}.uog.edu.et",is_primary=True,status="ACTIVE")
    asset=upload(w,storage); foreign=upload(w,storage,w.b,w.both)
    process_asset(asset.pk,storage=storage); process_asset(foreign.pk,storage=storage)
    page=_publish(w,asset)
    for reference in MediaDerivative.objects.filter(asset=asset).values_list("storage_reference",flat=True):
        storage.delete(*reference.split(":",1))
    private=f"/api/v1/sites/{w.a.pk}/assets/{asset.pk}/image/?variant=thumbnail"
    response=client(w).get(private,HTTP_ACCEPT="image/webp")
    assert response.status_code==200 and response["X-Media-Fallback"]=="original-regenerated"
    assert response["Content-Type"]=="image/webp" and "no-store" in response["Cache-Control"]
    assert client(w).get(f"/api/v1/sites/{w.a.pk}/assets/{foreign.pk}/image/").status_code==404
    public=f"/api/v1/site-context/media/{asset.pk}/?variant=display"
    anonymous=Client()
    served=anonymous.get(public,HTTP_HOST="thumb-a.uog.edu.et")
    assert served.status_code==200,served.content
    assert served["X-Media-Fallback"]=="original-regenerated" and "Host" in served["Vary"]
    assert anonymous.get(public,HTTP_HOST="thumb-b.uog.edu.et").status_code==404
    assert anonymous.get(f"/api/v1/site-context/media/{foreign.pk}/",HTTP_HOST="thumb-a.uog.edu.et").status_code==404
    assert anonymous.get(f"/api/v1/site-context/media/{foreign.pk}/",HTTP_HOST="thumb-b.uog.edu.et").status_code==404 # unpublished
    transition_with_site_role(page,"unpublish",get_user_model().objects.get(username="thumbnail-publish"))
    assert anonymous.get(public,HTTP_HOST="thumb-a.uog.edu.et").status_code==404
    assert client(w).get(private).status_code==200
    storage.delete(*asset.storage_reference.split(":",1))
    missing=client(w).get(private,HTTP_ACCEPT="image/webp")
    assert missing.status_code==404 and missing["Content-Type"].startswith("application/json")
    assert anonymous.get(public,HTTP_HOST="thumb-a.uog.edu.et").status_code==404


def test_stale_jobs_missing_identity_and_archived_site_cannot_be_resurrected(media_world, derivative_storage, monkeypatch):
    w=media_world; storage=derivative_storage; asset=upload(w,storage)
    assert tasks.process_media_asset.run(str(uuid.uuid4())) is None
    render=processing.render_variant
    once=False
    def archive_during_render(*args,**kwargs):
        nonlocal once
        result=render(*args,**kwargs)
        if not once:
            once=True; archive_site(w.a.pk)
        return result
    monkeypatch.setattr(processing,"render_variant",archive_during_render)
    process_asset(asset.pk,storage=storage)
    assert not MediaDerivative.objects.exists()
    asset.refresh_from_db(); assert asset.status=="PENDING"
    tasks.process_media_asset.run(str(asset.pk))
    assert not MediaDerivative.objects.exists()


def test_concurrent_duplicate_deliveries_have_one_durable_result(media_world, derivative_storage):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from django.db import close_old_connections
    w=media_world; storage=derivative_storage; asset=upload(w,storage); barrier=Barrier(2)
    def run():
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            process_asset(asset.pk,storage=storage)
        finally: close_old_connections()
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures=[executor.submit(run) for _ in range(2)]
        for future in futures: future.result(timeout=30)
    assert MediaDerivative.objects.filter(asset=asset).count()==2
    assert MediaProcessing.objects.get(asset=asset).attempts==1
    assert len([key for _,key in storage.writes if "/derivatives/" in key])==2


def test_live_lease_and_exhausted_dead_worker_are_fenced(media_world, derivative_storage, settings):
    w=media_world; storage=derivative_storage; asset=upload(w,storage)
    with processing.processing_write(asset):
        job=MediaProcessing.objects.get(asset=asset)
        job.state="PROCESSING"; job.attempts=settings.MEDIA_PROCESSING_MAX_ATTEMPTS
        job.lease_until=timezone.now()+timedelta(seconds=60); job.save()
    process_asset(asset.pk,storage=storage)
    assert not MediaDerivative.objects.exists() and MediaProcessing.objects.get(asset=asset).state=="PROCESSING"
    with processing.processing_write(asset):
        job.lease_until=timezone.now()-timedelta(seconds=1); job.save()
    process_asset(asset.pk,storage=storage)
    job.refresh_from_db(); asset.refresh_from_db()
    assert job.state=="FAILED" and job.failure_code=="RETRY_EXHAUSTED" and asset.status=="REJECTED"
    assert not MediaDerivative.objects.exists()


def test_archived_ready_asset_stays_archived_on_stale_delivery(media_world, derivative_storage):
    w=media_world; storage=derivative_storage; asset=upload(w,storage)
    process_asset(asset.pk,storage=storage)
    update_asset(w.actor,w.a.pk,asset.pk,changes={"status":"ARCHIVED"})
    writes=len(storage.writes)
    tasks.process_media_asset.run(str(asset.pk))
    asset.refresh_from_db()
    assert asset.status=="ARCHIVED" and len(storage.writes)==writes
    assert client(w).get(f"/api/v1/sites/{w.a.pk}/assets/{asset.pk}/image/").status_code==404


@pytest.mark.skipif(os.environ.get("RUN_MEDIA_MINIO_TESTS")!="1", reason="Requires private MinIO integration environment")
def test_real_minio_duplicate_and_missing_thumbnail_fallback(media_world, monkeypatch):
    from apps.media.storage import ObjectStorage
    from urllib.request import urlopen
    from urllib.error import HTTPError
    from django.conf import settings
    w=media_world; storage=ObjectStorage()
    monkeypatch.setattr("apps.media.uploads.enqueue",lambda _:None)
    asset=upload(w,storage)
    try:
        process_asset(asset.pk,storage=storage)
        process_asset(asset.pk,storage=storage)
        assert MediaProcessing.objects.get(asset=asset).attempts==1
        records=list(MediaDerivative.objects.filter(asset=asset))
        assert len(records)==2
        thumb=MediaDerivative.objects.get(asset=asset,variant="thumbnail")
        bucket,key=thumb.storage_reference.split(":",1)
        with pytest.raises(HTTPError) as denied:
            urlopen(f"{settings.AWS_S3_ENDPOINT_URL}/{bucket}/{key}")
        assert denied.value.code==403
        endpoint=f"/api/v1/sites/{w.a.pk}/assets/{asset.pk}/image/?variant=thumbnail"
        before=client(w).get(endpoint,HTTP_ACCEPT="image/webp")
        assert before.status_code==200 and before["X-Media-Fallback"]=="stored-derivative"
        storage.delete(bucket,key)
        fallback=client(w).get(endpoint,HTTP_ACCEPT="image/webp")
        assert fallback.status_code==200 and fallback["X-Media-Fallback"]=="original-regenerated"
        with Image.open(io.BytesIO(fallback.content)) as image:
            assert image.format=="WEBP"
        output=os.environ.get("MEDIA_THUMBNAIL_EVIDENCE_PATH")
        if output:
            Path(output).write_text(json.dumps({"duplicate_deliveries":2,"durable_attempts":1,"derivative_records":2,
                "variants":[row.variant for row in records],"format":"image/webp","anonymous_storage_status":403,
                "stored_response":before.status_code,"missing_thumbnail_response":fallback.status_code,
                "fallback":fallback["X-Media-Fallback"],"cache_control":fallback["Cache-Control"]},indent=2))
    finally:
        for variant in processing.VARIANTS:
            storage.delete(*processing.derivative_reference(asset,variant).split(":",1))
        storage.delete(*asset.storage_reference.split(":",1))


def test_real_celery_eager_retry_execution_reports_terminal_processing_outcome(media_world, derivative_storage, settings):
    w=media_world; storage=derivative_storage
    settings.MEDIA_PROCESSING_MAX_ATTEMPTS=3
    settings.MEDIA_PROCESSING_RETRY_SECONDS=0
    asset=upload(w,storage); storage.fail_derivatives=True
    result=tasks.process_media_asset.apply(args=(str(asset.pk),),throw=False)
    outcome=result.get(timeout=5)
    assert outcome=={"asset_id":str(asset.pk),"status":"REJECTED","processing_state":"FAILED"}
    assert MediaProcessing.objects.get(asset=asset).attempts==3
    duplicate=tasks.process_media_asset.apply(args=(str(asset.pk),),throw=False).get(timeout=5)
    assert duplicate==outcome and MediaProcessing.objects.get(asset=asset).attempts==3
