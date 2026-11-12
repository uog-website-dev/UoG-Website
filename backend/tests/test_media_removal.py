"""Atomic draft/public inventories, removal races and post-commit cleanup."""
import copy
import io
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from datetime import timedelta
import json, os
from pathlib import Path

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import transaction,IntegrityError,close_old_connections
from django.http import Http404
from django.test import Client
from django.utils import timezone
from rest_framework.test import APIClient
from apps.sites.api.access import Conflict
from apps.sites.models import SiteDomain
from apps.sites.services.lifecycle import activate_site
from apps.media.models import MediaAsset,MediaUsage,MediaCleanup,MediaAssetReference
from apps.media.services import attach_asset,detach_reference,update_asset,asset_write
from apps.media.uploads import upload_asset,process_asset
from apps.media.removal import remove_asset,cleanup_asset
from apps.cms.services.pages import create_page
from apps.cms.services.working_drafts import open_working_draft
from apps.cms.tests.support import transition_with_site_role
from apps.cms.services.publication_cache import current_publication_version
from .test_media_assets import media_world
from .test_media_derivatives import derivative_storage
from .test_media_uploads import png

pytestmark=pytest.mark.django_db(transaction=True)


def asset(w,storage):
    row=upload_asset(w.actor,w.a.pk,io.BytesIO(png()),filename="campus.png",request_key=uuid.uuid4(),storage=storage)
    process_asset(row.pk,storage=storage)
    return row


def publish(page):
    for action in ("submit","approve","publish"):
        actor=get_user_model().objects.create_user(username=f"remove-{action}-{uuid.uuid4().hex[:10]}")
        transition_with_site_role(page,action,actor)


def api(w):
    result=APIClient();result.force_authenticate(w.actor);return result


def tree(row):
    return [{"type":"section","id":"outer","children":[{"type":"section","id":"inner","children":[
        {"type":"slider","id":"hero","slides":[{"id":"slide-1","asset_id":str(row.pk),"alt":"Campus"}]}]}]}]


def test_nested_publication_retention_removal_and_private_public_cache_boundaries(media_world,derivative_storage,monkeypatch,settings):
    w=media_world; storage=derivative_storage
    monkeypatch.setattr("apps.media.removal.enqueue_cleanup",lambda _:None)
    settings.ALLOWED_HOSTS=["testserver",".uog.edu.et"]
    activate_site(w.a.pk);activate_site(w.b.pk)
    for site,name in ((w.a,"remove-a"),(w.b,"remove-b")):
        SiteDomain.objects.create(site=site,hostname=f"{name}.uog.edu.et",status="ACTIVE",is_primary=True)
    row=asset(w,storage);root=f"/api/v1/sites/{w.a.pk}/assets/{row.pk}/"
    private=root+"image/";public=f"/api/v1/site-context/media/{row.pk}/"
    client=api(w);anon=Client()
    page=create_page(site=w.a,title="Nested media",slug="nested-media",blocks=tree(row),actor=w.actor)
    assert MediaUsage.objects.get(asset=row).scope=="DRAFT"
    assert client.get(private).status_code==200
    before=anon.get(public,HTTP_HOST="remove-a.uog.edu.et")
    assert before.status_code==404 and "no-store" in before["Cache-Control"]
    publish(page);page.refresh_from_db()
    assert list(MediaUsage.objects.filter(asset=row).values_list("scope",flat=True))==["PUBLIC"]
    served=anon.get(public,HTTP_HOST="remove-a.uog.edu.et")
    assert served.status_code==200
    assert anon.get(public,HTTP_HOST="remove-b.uog.edu.et").status_code==404
    assert client.get(f"/api/v1/sites/{w.b.pk}/assets/{row.pk}/image/").status_code==403
    # Warm the ordinary published Page cache as well as requesting media.
    assert anon.get("/api/v1/site-context/pages/nested-media/",HTTP_HOST="remove-a.uog.edu.et").status_code==200
    draft,_=open_working_draft(page,actor=w.actor)
    draft.blocks=copy.deepcopy(draft.blocks);draft.blocks[0]["children"][0]["children"][0]["slides"]=[]
    draft.updated_by=w.actor;draft.save()
    inventory=client.get(root+"references/").json()
    assert len(inventory["references"])==1 and inventory["references"][0]["scope"]=="PUBLIC"
    use=inventory["references"][0]
    assert use["node_id"]=="hero" and use["field_path"]=="slides.asset_id" and use["repeater_item_id"]=="slide-1"
    generation=current_publication_version(w.a.pk,page.locale)
    denied=client.delete(root)
    assert denied.status_code==409 and current_publication_version(w.a.pk,page.locale)==generation
    assert anon.get(public,HTTP_HOST="remove-a.uog.edu.et").status_code==200
    publish(draft)
    assert not MediaUsage.objects.filter(asset=row).exists()
    withdrawn=anon.get(public,HTTP_HOST="remove-a.uog.edu.et")
    assert withdrawn.status_code==404 and "no-store" in withdrawn["Cache-Control"] and "Host" in withdrawn["Vary"]
    assert client.get(private).status_code==200
    # Explicit placements remain protective even when current documents no longer use it.
    page.refresh_from_db()
    manual=attach_asset(w.actor,w.a.pk,asset_id=row.pk,page_revision_id=page.revisions.latest("revision_number").pk,node_id="manual",field_path="image")
    assert client.delete(root).status_code==409
    detach_reference(w.actor,w.a.pk,manual.pk)
    generation=current_publication_version(w.a.pk,page.locale)
    removed=client.delete(root)
    assert removed.status_code==202,removed.content
    assert current_publication_version(w.a.pk,page.locale)>generation
    assert client.get(root).status_code==404 and client.get(private).status_code==404
    assert client.get(f"/api/v1/sites/{w.a.pk}/assets/?ready_images=true").json()["results"]==[]
    assert client.patch(root,{"status":"READY"},format="json").status_code==404
    assert client.delete(root).status_code==202
    with pytest.raises(IntegrityError):
        with asset_write(w.actor,w.a.pk,"content.media.upload"):
            MediaAsset.objects.filter(pk=row.pk).update(status="READY")
    assert len(storage.objects)==3
    job=cleanup_asset(row.pk,storage=storage)
    assert job.state=="DONE" and not storage.objects
    assert cleanup_asset(row.pk,storage=storage).attempts==1
    row.refresh_from_db();assert row.deleted_at and row.deleted_by_id==w.actor.pk
    output=os.environ.get("MEDIA_REMOVAL_EVIDENCE_PATH")
    if output:
        Path(output).write_text(json.dumps({"inventory_while_draft_removed":inventory,"blocked_delete_status":denied.status_code,
          "preview_before_publication":200,"anonymous_before_publication":before.status_code,"published_image":served.status_code,
          "public_headers":{"cache_control":served["Cache-Control"],"vary":served["Vary"]},
          "withdrawn_image":withdrawn.status_code,"accepted_delete_status":removed.status_code,"cleanup_state":job.state,
          "generation_before_delete":generation,"generation_after_delete":current_publication_version(w.a.pk,page.locale)},indent=2))


def test_gallery_and_image_slots_share_one_asset_without_copying(media_world,derivative_storage):
    w=media_world; row=asset(w,derivative_storage)
    blocks=tree(row)
    blocks[0]["children"][0]["children"].append({"type":"gallery","id":"gallery","images":[{"id":"photo-a","asset_id":str(row.pk),"alt":"Campus"},{"id":"photo-b","asset_id":str(row.pk),"alt":"Same asset"}]})
    blocks[0]["children"].append({"type":"image","id":"single","ref":f"sites/{w.a.pk}/assets/{row.pk}","alt":"Campus"})
    page=create_page(site=w.a,title="Many placements",slug="placements",blocks=blocks,actor=w.actor)
    assert MediaAsset.objects.count()==1 and MediaUsage.objects.filter(asset=row).count()==4
    with pytest.raises(Conflict):remove_asset(w.actor,w.a.pk,row.pk)
    page.blocks=[];page.save()
    assert not MediaUsage.objects.filter(asset=row).exists()


@pytest.mark.parametrize("mode",["manual","draft"])
def test_removal_races_linking_without_dangling_references(media_world,derivative_storage,monkeypatch,mode):
    w=media_world;row=asset(w,derivative_storage)
    monkeypatch.setattr("apps.media.removal.enqueue_cleanup",lambda _:None)
    page=create_page(site=w.a,title="Race",slug="race",actor=w.actor)
    revision=page.revisions.latest("revision_number");barrier=Barrier(2)
    def run(delete):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            try:
                if delete:remove_asset(w.actor,w.a.pk,row.pk)
                elif mode=="manual":attach_asset(w.actor,w.a.pk,asset_id=row.pk,page_revision_id=revision.pk,node_id="race",field_path="image")
                else:create_page(site=w.a,title="Race link",slug="race-link",blocks=tree(row),actor=w.actor)
                return "won"
            except (Conflict,Http404,ValidationError,IntegrityError):return "blocked"
        finally:close_old_connections()
    with ThreadPoolExecutor(max_workers=2) as pool:
        deletion=pool.submit(run,True);linking=pool.submit(run,False)
        outcomes=(deletion.result(timeout=30),linking.result(timeout=30))
    assert sorted(outcomes)==["blocked","won"]
    row.refresh_from_db()
    references=MediaUsage.objects.filter(asset=row).count()+MediaAssetReference.objects.filter(asset=row).count()
    assert (row.deleted_at is not None and references==0) or (row.deleted_at is None and references==1)
    output = os.environ.get("MEDIA_REMOVAL_RACE_EVIDENCE_PATH")
    if output:
        path = Path(output)
        result = json.loads(path.read_text()) if path.exists() and mode != "manual" else {}
        result[mode] = {"deletion": outcomes[0], "linking": outcomes[1], "deleted": row.deleted_at is not None, "references": references}
        path.write_text(json.dumps(result, indent=2))


def test_deletion_rollback_does_not_dispatch_or_remove_storage(media_world,derivative_storage,monkeypatch):
    w=media_world;row=asset(w,derivative_storage);calls=[]
    monkeypatch.setattr("apps.media.removal.enqueue_cleanup",calls.append)
    with pytest.raises(RuntimeError),transaction.atomic():
        remove_asset(w.actor,w.a.pk,row.pk)
        raise RuntimeError("rollback")
    row.refresh_from_db()
    assert row.deleted_at is None and row.status=="READY" and not MediaCleanup.objects.exists() and not calls
    assert len(derivative_storage.objects)==3


def test_cleanup_failure_is_reconciled_without_reexposing_asset(media_world,derivative_storage,monkeypatch):
    w=media_world;storage=derivative_storage;row=asset(w,storage)
    monkeypatch.setattr("apps.media.removal.enqueue_cleanup",lambda _:None)
    remove_asset(w.actor,w.a.pk,row.pk);storage.fail_delete=True
    job=cleanup_asset(row.pk,storage=storage)
    assert job.state=="RETRY" and len(storage.objects)==3
    assert api(w).get(f"/api/v1/sites/{w.a.pk}/assets/{row.pk}/").status_code==404
    storage.fail_delete=False
    later=timezone.now()+timedelta(hours=2);monkeypatch.setattr("django.utils.timezone.now",lambda:later)
    job=cleanup_asset(row.pk,storage=storage)
    assert job.state=="DONE" and job.attempts==2 and not storage.objects


def test_public_eligibility_is_rechecked_after_storage_io(media_world, derivative_storage, monkeypatch, settings):
    w = media_world
    settings.ALLOWED_HOSTS = ["testserver", ".uog.edu.et"]
    activate_site(w.a.pk)
    SiteDomain.objects.create(site=w.a, hostname="io-withdraw.uog.edu.et", status="ACTIVE", is_primary=True)
    row = asset(w, derivative_storage)
    page = create_page(site=w.a, title="Withdrawal", slug="withdrawal", blocks=tree(row), actor=w.actor)
    publish(page)
    original_open = derivative_storage.open
    withdrawn = False
    def withdraw_during_read(*args, **kwargs):
        nonlocal withdrawn
        if not withdrawn:
            withdrawn = True
            page.refresh_from_db()
            publisher = get_user_model().objects.create_user(username=f"withdraw-{uuid.uuid4().hex[:10]}")
            transition_with_site_role(page, "unpublish", publisher)
        return original_open(*args, **kwargs)
    monkeypatch.setattr(derivative_storage, "open", withdraw_during_read)
    response = Client().get(f"/api/v1/site-context/media/{row.pk}/", HTTP_HOST="io-withdraw.uog.edu.et")
    assert withdrawn and response.status_code == 404
    assert "no-store" in response["Cache-Control"]


def test_upgrade_backfills_current_sets_without_rewriting_revisions(media_world, derivative_storage):
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    w = media_world
    row = asset(w, derivative_storage)
    page = create_page(site=w.a, title="Upgrade inventory", slug="upgrade-inventory", blocks=tree(row), actor=w.actor)
    publish(page)
    draft, _ = open_working_draft(page, actor=w.actor)
    draft.blocks = []
    draft.updated_by = w.actor
    draft.save()
    snapshots = list(page.revisions.order_by("pk").values_list("pk", "snapshot"))
    executor = MigrationExecutor(connection)
    leaves = executor.loader.graph.leaf_nodes()
    try:
        executor.migrate([("media", "0008_processing_retry_retention"), ("cms", "0012_page_working_draft")])
    finally:
        MigrationExecutor(connection).migrate(leaves)
    uses = list(MediaUsage.objects.filter(asset=row).values_list("scope", "node_id", "repeater_item_id"))
    assert uses == [("PUBLIC", "hero", "slide-1")]
    assert list(page.revisions.order_by("pk").values_list("pk", "snapshot")) == snapshots


@pytest.mark.skipif(os.environ.get("RUN_MEDIA_MINIO_TESTS") != "1", reason="Requires private MinIO integration environment")
def test_real_minio_accepted_cleanup_removes_only_owned_objects(media_world, monkeypatch):
    from apps.media.storage import ObjectStorage
    from apps.media.processing import derivative_reference, VARIANTS
    w = media_world
    storage = ObjectStorage()
    monkeypatch.setattr("apps.media.uploads.enqueue", lambda _: None)
    monkeypatch.setattr("apps.media.removal.enqueue_cleanup", lambda _: None)
    row = asset(w, storage)
    foreign = asset(w, storage)
    refs = [row.storage_reference, *(derivative_reference(row, variant) for variant in VARIANTS)]
    try:
        remove_asset(w.actor, w.a.pk, row.pk)
        assert cleanup_asset(row.pk, storage=storage).state == "DONE"
        assert cleanup_asset(row.pk, storage=storage).attempts == 1
        for ref in refs:
            with pytest.raises(Http404):
                with storage.open(*ref.split(":", 1)) as stream:
                    stream.read(1)
        with storage.open(*foreign.storage_reference.split(":", 1)) as stream:
            assert stream.read(1)
    finally:
        for owned in (row, foreign):
            for ref in [owned.storage_reference, *(derivative_reference(owned, variant) for variant in VARIANTS)]:
                storage.delete(*ref.split(":", 1))


def test_foreign_or_unauthorized_removal_has_no_effect(media_world, derivative_storage, monkeypatch):
    w = media_world
    row = asset(w, derivative_storage)
    client = api(w)
    monkeypatch.setattr("apps.media.removal.enqueue_cleanup", lambda _: pytest.fail("Unauthorized cleanup dispatch"))
    assert client.delete(f"/api/v1/sites/{w.b.pk}/assets/{row.pk}/").status_code == 403
    assert client.get(f"/api/v1/sites/{w.b.pk}/assets/{row.pk}/references/").status_code == 403
    assert client.get(f"/api/v1/sites/{w.b.pk}/assets/{row.pk}/deletion/").status_code == 403
    assert APIClient().delete(f"/api/v1/sites/{w.a.pk}/assets/{row.pk}/").status_code in (401, 403)
    row.refresh_from_db()
    assert row.deleted_at is None and row.status == "READY"
    assert not MediaCleanup.objects.exists() and len(derivative_storage.objects) == 3
