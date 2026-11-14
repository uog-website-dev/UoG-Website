"""Regression coverage for media audit fixes and storage I/O critical sections."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event
import io, uuid
import pytest
from django.db import connection, connections, transaction, close_old_connections, IntegrityError
from django.db.migrations.executor import MigrationExecutor
from apps.cms.services.pages import create_page
from apps.media.models import MediaUsage, MediaProcessing, MediaDerivative
from apps.media.removal import remove_asset, cleanup_asset
from apps.media.uploads import upload_asset, process_asset
from apps.media.services import asset_write
from apps.sites.api.access import Conflict
from .test_media_assets import media_world
from .test_media_derivatives import derivative_storage
from .test_media_removal import asset
from .test_media_uploads import png
pytestmark = pytest.mark.django_db(transaction=True)


def test_compact_uuid_is_canonical_and_protected(media_world, derivative_storage, monkeypatch):
    w = media_world
    row = asset(w, derivative_storage)
    monkeypatch.setattr("apps.media.removal.enqueue_cleanup", lambda _: None)
    page = create_page(site=w.a, title="Compact UUID", slug="compact", actor=w.actor, blocks=[
      {"type":"image", "id":"image", "ref":f"sites/0{w.a.pk}/assets/{row.pk.hex}", "alt":"Campus"}])
    assert page.blocks[0]["ref"] == f"sites/{w.a.pk}/assets/{row.pk}"
    assert MediaUsage.objects.filter(asset=row, scope="DRAFT").count() == 1
    with pytest.raises(Conflict): remove_asset(w.actor, w.a.pk, row.pk)


def test_forward_migration_indexes_historical_compact_uuid_without_history_rewrite(media_world, derivative_storage, monkeypatch):
    w = media_world
    row = asset(w, derivative_storage)
    executor = MigrationExecutor(connection)
    leaves = executor.loader.graph.leaf_nodes()
    try:
        executor.migrate([("media", "0010_reference_inventory_and_removal")])
        # Build data using baseline models; today's revision retention query
        # legitimately refers to approved_revision_id added after this baseline.
        loader=MigrationExecutor(connection).loader
        old_apps=loader.project_state(list(loader.applied_migrations)).apps
        OldPage=old_apps.get_model("cms","Page")
        OldRevision=old_apps.get_model("cms","ContentRevision")
        from apps.cms.services.revisions import content_revision_write
        import hashlib,json
        with content_revision_write(using="default"):
            page=OldPage.objects.create(created_by_id=w.actor.pk,updated_by_id=w.actor.pk,site_id=w.a.pk,title="Historical UUID",slug="history",path="/history",locale="en-us",revision_number=1,blocks=[{"type":"image","id":"image","ref":f"sites/{w.a.pk}/assets/{row.pk.hex}","alt":"Campus"}])
            snapshot={"content_id":str(page.pk),"site_id":w.a.pk,"title":page.title,"slug":page.slug,"path":page.path,"blocks":page.blocks,"metadata":{},"status":"DRAFT"}
            revision=OldRevision.objects.create(content_id=page.pk,site_id=w.a.pk,revision_number=1,status="DRAFT",snapshot=snapshot,changed_fields=["__created__"],content_hash=hashlib.sha256(json.dumps(snapshot,sort_keys=True).encode()).hexdigest())
        assert not MediaUsage.objects.filter(asset=row).exists()
    finally:
        MigrationExecutor(connection).migrate(leaves)
    assert MediaUsage.objects.filter(asset=row, scope="DRAFT").count() == 1
    from apps.cms.models import ContentRevision
    assert ContentRevision.objects.get(pk=revision.pk).snapshot == snapshot
    with pytest.raises(Conflict): remove_asset(w.actor, w.a.pk, row.pk)


def _thread(call):
    close_old_connections()
    try: return call()
    finally: connections.close_all()


def _unrelated_write_can_acquire_guard():
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("SET LOCAL lock_timeout='300ms'")
        cursor.execute("SELECT organizations_lock_hierarchy()")


def test_cleanup_io_does_not_hold_platform_write_guard(media_world, derivative_storage, monkeypatch):
    w = media_world
    row = asset(w, derivative_storage)
    monkeypatch.setattr("apps.media.removal.enqueue_cleanup", lambda _: None)
    remove_asset(w.actor, w.a.pk, row.pk)
    entered, release = Event(), Event()
    original = derivative_storage.delete
    def paused(*args):
        entered.set()
        assert release.wait(10)
        return original(*args)
    derivative_storage.delete = paused
    with ThreadPoolExecutor(max_workers=1) as pool:
        task = pool.submit(_thread, lambda: cleanup_asset(row.pk, storage=derivative_storage))
        try:
            assert entered.wait(10)
            _unrelated_write_can_acquire_guard()
            # A duplicate cleanup skips this busy asset rather than holding a DB lock.
            assert cleanup_asset(str(row.pk).upper(), storage=derivative_storage).state == "QUEUED"
        finally: release.set()
        assert task.result(timeout=10).state == "DONE"


def test_deletion_during_derivative_put_waits_for_io_before_cleanup(media_world, derivative_storage, monkeypatch):
    w = media_world
    row = upload_asset(w.actor, w.a.pk, io.BytesIO(png()), filename="campus.png", request_key=uuid.uuid4(), storage=derivative_storage)
    monkeypatch.setattr("apps.media.removal.enqueue_cleanup", lambda _: None)
    entered, release = Event(), Event()
    original = derivative_storage.put
    def paused(bucket, key, *args, **kwargs):
        if "/derivatives/" in key:
            entered.set()
            assert release.wait(10)
        return original(bucket, key, *args, **kwargs)
    derivative_storage.put = paused
    with ThreadPoolExecutor(max_workers=1) as pool:
        task = pool.submit(_thread, lambda: process_asset(row.pk, storage=derivative_storage))
        try:
            assert entered.wait(10)
            _unrelated_write_can_acquire_guard()
            remove_asset(w.actor, w.a.pk, row.pk)
            assert cleanup_asset(row.pk, storage=derivative_storage).state == "QUEUED"
        finally: release.set()
        task.result(timeout=10)
    row.refresh_from_db()
    assert row.deleted_at is not None and row.status == "ARCHIVED"
    assert not MediaDerivative.objects.filter(asset=row).exists()
    assert cleanup_asset(row.pk, storage=derivative_storage).state == "DONE"
    assert not derivative_storage.objects


@pytest.mark.parametrize("state",["PENDING","REJECTED"])
def test_non_ready_removal_requires_the_tombstone_service(media_world,derivative_storage,monkeypatch,state):
    w=media_world
    row=upload_asset(w.actor,w.a.pk,io.BytesIO(png()),filename="pending.png",request_key=uuid.uuid4(),storage=derivative_storage)
    monkeypatch.setattr("apps.media.removal.enqueue_cleanup",lambda _:None)
    if state=="REJECTED":
        # Exercise the real worker rejection path; uploads cannot change
        # lifecycle state through ordinary metadata writes.
        derivative_storage.objects.pop(tuple(row.storage_reference.split(":",1)))
        row=process_asset(row.pk,storage=derivative_storage)
        assert row.status=="REJECTED"
    with pytest.raises(IntegrityError),asset_write(w.actor,w.a.pk,"content.media.delete"):
        row.status="ARCHIVED"
        row.save(update_fields=["status","updated_at"])
    row.refresh_from_db()
    assert row.status==state and row.deleted_at is None
    deleted,_=remove_asset(w.actor,w.a.pk,row.pk)
    assert deleted.status=="ARCHIVED" and deleted.deleted_at is not None
