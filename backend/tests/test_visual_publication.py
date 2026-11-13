"""Reviewed revision provenance, private previews, assets and commit-only caching."""
from apps.cms.tests.support import grant_cms_role
import copy
from unittest.mock import patch
import pytest
from django.contrib.auth import get_user_model
from django.db import transaction, IntegrityError
from django.test import Client
from apps.cms.models import ContentRevision,ContentWorkflowTransition,PublishedContentSnapshot,ContentRole,Page
from apps.cms.services.workflow import transition_content
from apps.cms.services.working_drafts import content_etag,open_working_draft,save_visual_draft
from apps.cms.services.publication_cache import current_publication_version,public_cache_key,get_public_cache,set_public_cache
from apps.media.models import MediaUsage
from apps.sites.models import SiteDomain
from apps.sites.services.lifecycle import activate_site
from .test_media_assets import media_world
from .test_media_derivatives import derivative_storage
from .test_visual_drafts import world,tree,client

pytestmark=pytest.mark.django_db(transaction=True)


def roles(w):
    reviewer=get_user_model().objects.create_user(username="visual-reviewer")
    publisher=get_user_model().objects.create_user(username="visual-publisher")
    grant_cms_role(site=w.a,user=reviewer,role=ContentRole.REVIEWER)
    grant_cms_role(site=w.a,user=publisher,role=ContentRole.PUBLISHER)
    return reviewer,publisher


def action(w,page,actor,name,etag=None):
    return client(actor).post(f"/api/v1/sites/{w.a.pk}/pages/{page.pk}/workflow/",{"action":name},format="json",**({"HTTP_IF_MATCH":etag} if etag else {}))


def approve(w,page,reviewer):
    assert action(w,page,w.actor,"submit").status_code==200
    page.refresh_from_db()
    preview=client(reviewer).get(f"/api/v1/sites/{w.a.pk}/pages/{page.pk}/preview/")
    assert preview.status_code==200,preview.data
    result=action(w,page,reviewer,"approve",preview["ETag"])
    assert result.status_code==200,result.data
    page.refresh_from_db();return result


def host(w,settings):
    settings.ALLOWED_HOSTS=["testserver",".uog.edu.et"]
    activate_site(w.a.pk)
    SiteDomain.objects.create(site=w.a,hostname="reviewed-visual.uog.edu.et",status="ACTIVE",is_primary=True)
    return "reviewed-visual.uog.edu.et"


def test_approval_binds_revision_and_changed_tree_requires_fresh_review(world):
    w,page=world.w,world.page;reviewer,publisher=roles(w)
    approved=approve(w,page,reviewer)
    binding=ContentWorkflowTransition.objects.get(content=page,to_status="APPROVED")
    assert binding.revision.revision_number==page.revision_number
    assert binding.reviewed_revision.revision_number==page.revision_number-1
    assert binding.reviewed_revision.snapshot["metadata"]==binding.revision.snapshot["metadata"]
    assert action(w,page,publisher,"publish").status_code==428
    reopened=action(w,page,w.actor,"revise",approved["ETag"])
    assert reopened.status_code==200,reopened.data
    changed=tree(world.second,world.first);changed["rows"][0]["columns"].reverse()
    saved=client(w.actor).patch(f"/api/v1/sites/{w.a.pk}/pages/{page.pk}/visual-draft/",{"visual_layout":changed},format="json",HTTP_IF_MATCH=reopened["ETag"])
    assert saved.status_code==200
    assert action(w,page,publisher,"publish",approved["ETag"]).status_code==409
    assert action(w,page,publisher,"publish",saved["ETag"]).status_code==409
    assert not PublishedContentSnapshot.objects.filter(content=page).exists()
    page.refresh_from_db();approved_new=approve(w,page,reviewer)
    published=action(w,page,publisher,"publish",approved_new["ETag"])
    assert published.status_code==200,published.data
    snapshot=PublishedContentSnapshot.objects.get(content=page)
    assert snapshot.approved_revision_id != binding.revision_id
    assert snapshot.payload["metadata"]["visual_layout"]==changed
    assert snapshot.approval.reviewed_revision_id is not None


def test_private_revision_preview_and_image_never_enter_public_delivery(world,settings):
    w,page=world.w,world.page;reviewer,publisher=roles(w);hostname=host(w,settings)
    url=f"/api/v1/sites/{w.a.pk}/pages/{page.pk}/preview/"
    anonymous=Client().get(url)
    assert anonymous.status_code in (401,403) and "no-store" in anonymous["Cache-Control"]
    private=client(reviewer).get(url)
    assert private.status_code==200
    assert {"Cookie","Authorization","Host"} <= set(part.strip() for part in private["Vary"].split(","))
    assert private["Cache-Control"]=="private, no-store" and private["Surrogate-Control"]=="no-store"
    assert client(reviewer).get(url,{"asset_id":str(world.first.pk)}).status_code==200
    assert client(reviewer).get(url,{"asset_id":str(world.second.pk)}).status_code==404
    assert client(reviewer).get(url.replace(f"/{w.a.pk}/",f"/{w.b.pk}/")).status_code in (403,404)
    public=Client().get(f"/api/v1/site-context/media/{world.first.pk}/",HTTP_HOST=hostname)
    assert public.status_code==404
    version=current_publication_version(w.a.pk,page.locale)
    approve(w,page,reviewer)
    historical=client(reviewer).get(url,{"revision":private.data["revision_number"]})
    assert historical.data["page"]==private.data["page"]
    assert historical.data["revision_id"]==private.data["revision_id"]
    assert current_publication_version(w.a.pk,page.locale)==version


def test_unavailable_gallery_blocks_promotion_and_keeps_public_snapshot(world,settings):
    w,page=world.w,world.page;reviewer,publisher=roles(w);hostname=host(w,settings)
    initial=approve(w,page,reviewer);assert action(w,page,publisher,"publish",initial["ETag"]).status_code==200
    page.refresh_from_db();before=Client().get("/api/v1/site-context/pages/visual-draft/",HTTP_HOST=hostname)
    old=PublishedContentSnapshot.objects.get(content=page);version=current_publication_version(w.a.pk,page.locale)
    draft,_=open_working_draft(page,actor=w.actor)
    changed=tree(world.first)
    changed["rows"][0]["columns"][0]["children"].append({"id":"gallery-1","type":"image_grid","props":{"items":[{"id":"gallery-item-1","asset_id":str(world.second.pk),"alt":"Private gallery","caption":"Reviewed"}]}})
    save_visual_draft(site_id=w.a.pk,page_id=draft.pk,actor=w.actor,if_match=content_etag(draft),visual_layout=changed)
    draft.refresh_from_db();ready=approve(w,draft,reviewer)
    # Simulate an unavailable object outside the guarded DB lifecycle.
    refs={world.second.storage_reference,*world.second.derivatives.values_list("storage_reference",flat=True)}
    for ref in refs:
        world.storage.objects.pop(tuple(ref.split(":",1)),None)
    failed=action(w,draft,publisher,"publish",ready["ETag"])
    assert failed.status_code==400,failed.data
    assert "metadata.visual_layout" in str(failed.data)
    assert PublishedContentSnapshot.objects.filter(content=page).count()==1
    assert PublishedContentSnapshot.objects.get(content=page).pk==old.pk
    assert Client().get("/api/v1/site-context/pages/visual-draft/",HTTP_HOST=hostname).json()==before.json()
    assert current_publication_version(w.a.pk,page.locale)==version
    assert set(MediaUsage.objects.filter(page=page,scope="PUBLIC").values_list("asset_id",flat=True))=={world.first.pk}


def test_approved_slides_freeze_while_later_private_draft_and_restore_differ(world,settings):
    w,page=world.w,world.page;reviewer,publisher=roles(w);hostname=host(w,settings)
    layout=tree(world.first,world.second);layout["rows"][0]["columns"].reverse()
    save_visual_draft(site_id=w.a.pk,page_id=page.pk,actor=w.actor,if_match=content_etag(page),visual_layout=layout)
    page.refresh_from_db();approved=approve(w,page,reviewer)
    assert action(w,page,publisher,"publish",approved["ETag"]).status_code==200
    page.refresh_from_db();published=PublishedContentSnapshot.objects.get(content=page)
    draft,_=open_working_draft(page,actor=w.actor)
    old_revision=draft.revision_number
    changed=tree(world.second)
    save_visual_draft(site_id=w.a.pk,page_id=draft.pk,actor=w.actor,if_match=content_etag(draft),visual_layout=changed)
    preview=client(reviewer).get(f"/api/v1/sites/{w.a.pk}/pages/{draft.pk}/preview/")
    public=Client().get("/api/v1/site-context/pages/visual-draft/",HTTP_HOST=hostname)
    assert preview.data["page"]["metadata"]["visual_layout"]==changed
    assert public.json()["metadata"]["visual_layout"]==layout
    from apps.cms.services.revisions import restore_content_revision
    draft.refresh_from_db();restored,_=restore_content_revision(draft.pk,old_revision,actor=w.actor,expected_revision=draft.revision_number)
    assert restored.status=="DRAFT" and restored.metadata["visual_layout"]==layout
    assert PublishedContentSnapshot.objects.get(content=page).pk==published.pk


def test_cache_invalidation_runs_only_after_commit_and_rollback_preserves_cache(world,monkeypatch):
    from apps.cms.services import publication_cache
    w,page=world.w,world.page;reviewer,publisher=roles(w)
    approved=approve(w,page,reviewer)
    old_version=current_publication_version(w.a.pk,page.locale)
    key=public_cache_key(w.a.pk,page.locale,f"page:{page.path}",version=old_version)
    set_public_cache(w.a.pk,key,{"old":"public"})
    deletes=[];original=publication_cache.cache.delete
    monkeypatch.setattr(publication_cache.cache,"delete",lambda key,*a,**kw:(deletes.append(key),original(key,*a,**kw))[1])
    with pytest.raises(RuntimeError),transaction.atomic():
        transition_content(page.pk,action="publish",actor=publisher)
        assert not deletes and get_public_cache(w.a.pk,key)=={"old":"public"}
        raise RuntimeError("Roll back publication")
    assert not deletes and get_public_cache(w.a.pk,key)=={"old":"public"}
    assert not PublishedContentSnapshot.objects.filter(content=page).exists()
    with transaction.atomic():
        transition_content(page.pk,action="publish",actor=publisher)
        assert not deletes
    assert key in deletes and get_public_cache(w.a.pk,key) is None


def test_wrong_approval_cannot_create_publication_and_non_publishers_cannot_promote(world):
    w,page=world.w,world.page;reviewer,publisher=roles(w);approved=approve(w,page,reviewer)
    author_only=get_user_model().objects.create_user(username="author-without-publication")
    grant_cms_role(site=w.a,user=author_only,role=ContentRole.AUTHOR)
    assert action(w,page,author_only,"publish",approved["ETag"]).status_code==403
    assert action(w,page,author_only,"approve",approved["ETag"]).status_code==403
    from apps.cms.services import workflow
    original=workflow._create_publication_snapshot
    def fault(content,*,using,approval=None):
        assert approval is not None
        # A payload injected after approval must fail the database guard too.
        content.metadata=copy.deepcopy(content.metadata);content.metadata["visual_layout"]["rows"]=[]
        original(content,using=using,approval=approval)
    with patch.object(workflow,"_create_publication_snapshot",side_effect=fault),pytest.raises(IntegrityError):
        transition_content(page.pk,action="publish",actor=publisher)
    page.refresh_from_db();assert page.status=="APPROVED"
    assert not PublishedContentSnapshot.objects.filter(content=page).exists()


def test_missing_derivative_uses_private_original_and_approval_is_retained_on_upgrade(world):
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    w,page=world.w,world.page;reviewer,publisher=roles(w)
    approved=approve(w,page,reviewer)
    original_metadata=copy.deepcopy(page.metadata)
    executor=MigrationExecutor(connection);latest=executor.loader.graph.leaf_nodes()
    try:
        executor.migrate([("cms","0014_visual_layout_contract")])
        MigrationExecutor(connection).migrate(latest)
    finally:MigrationExecutor(connection).migrate(latest)
    page.refresh_from_db();assert page.metadata==original_metadata and page.status=="APPROVED"
    approval=ContentWorkflowTransition.objects.get(content=page,to_status="APPROVED")
    assert approval.revision_id and approval.reviewed_revision_id
    thumb=world.first.derivatives.get(variant="thumbnail")
    world.storage.objects.pop(tuple(thumb.storage_reference.split(":",1)))
    assert action(w,page,publisher,"publish",approved["ETag"]).status_code==200
    image=client(publisher).get(f"/api/v1/sites/{w.a.pk}/pages/{page.pk}/preview/",{"asset_id":str(world.first.pk),"variant":"thumbnail"})
    assert image.status_code==200 and image["X-Media-Fallback"]=="original-regenerated"


def test_failure_after_snapshot_and_public_references_rolls_back_promotion(world):
    from apps.cms.services import workflow
    w,page=world.w,world.page;reviewer,publisher=roles(w)
    initial=approve(w,page,reviewer)
    assert action(w,page,publisher,"publish",initial["ETag"]).status_code==200
    page.refresh_from_db();old=PublishedContentSnapshot.objects.get(content=page)
    old_metadata=copy.deepcopy(page.metadata)
    before=list(MediaUsage.objects.filter(page=page).values_list("asset_id","scope","revision_id","node_id","repeater_item_id"))
    version=current_publication_version(w.a.pk,page.locale)
    draft,_=open_working_draft(page,actor=w.actor)
    save_visual_draft(site_id=w.a.pk,page_id=draft.pk,actor=w.actor,if_match=content_etag(draft),visual_layout=tree(world.second))
    draft.refresh_from_db();approve(w,draft,reviewer)
    original=workflow._create_publication_snapshot
    def fail_after_write(content,*,using,approval=None):
        original(content,using=using,approval=approval)
        assert set(MediaUsage.objects.filter(page=page,scope="PUBLIC").values_list("asset_id",flat=True))=={world.second.pk}
        assert PublishedContentSnapshot.objects.filter(content=page).count()==2
        raise RuntimeError("Injected failure after snapshot and inventory")
    with patch.object(workflow,"_create_publication_snapshot",side_effect=fail_after_write),pytest.raises(RuntimeError):
        transition_content(draft.pk,action="publish",actor=publisher)
    page.refresh_from_db();draft.refresh_from_db()
    assert page.metadata==old_metadata and draft.status=="APPROVED"
    assert PublishedContentSnapshot.objects.get(content=page).pk==old.pk
    assert list(MediaUsage.objects.filter(page=page).values_list("asset_id","scope","revision_id","node_id","repeater_item_id"))==before
    assert current_publication_version(w.a.pk,page.locale)==version
