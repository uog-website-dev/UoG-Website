"""Transaction-level complete-tree save, publication isolation and editor races."""
from apps.cms.tests.support import grant_cms_role
import copy
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace
from pathlib import Path

import pytest
from django.contrib.auth import get_user_model
from django.db import connections, close_old_connections, IntegrityError
from django.test import Client
from rest_framework.test import APIClient
from apps.cms.models import ContentEditConflict, Page, ContentRevision, PublishedContentSnapshot, ContentRole
from apps.cms.services.working_drafts import content_etag, open_working_draft, save_visual_draft
from apps.media.models import MediaUsage
from apps.media.uploads import process_asset
from apps.sites.models import SiteDomain
from apps.sites.services.lifecycle import activate_site
from .test_media_assets import media_world
from .test_media_derivatives import derivative_storage, upload
from .test_media_removal import asset, publish

pytestmark = pytest.mark.django_db(transaction=True)
SAMPLE = json.loads((Path(__file__).parents[1] / "apps/cms/schemas/layout/fixtures.json").read_text())[0]["layout"]


def tree(first, second=None):
    doc = copy.deepcopy(SAMPLE)
    slider = doc["rows"][0]["columns"][1]["children"][0]
    slider["props"]["items"] = [{"id":"slide-1","asset_id":str(first.pk),"alt":"First slide","caption":"First caption"}]
    if second:
        slider["props"]["items"].append({"id":"slide-2","asset_id":str(second.pk),"alt":"Second slide","caption":"Second caption"})
    doc["rows"][0]["columns"][2]["children"].append({"id":"custom-slider","type":"layout_slider","props":{"items":[{"id":"custom-slide","children":[{"id":"nested-image","type":"image","props":{"asset_id":str(first.pk),"alt":"Nested image"}}]}]}})
    return doc


def client(actor):
    api = APIClient();api.force_authenticate(actor);return api


def endpoint(site, page):
    return f"/api/v1/sites/{site.pk}/pages/{page.pk}/visual-draft/"


def inventory(page):
    return list(MediaUsage.objects.filter(page=page).order_by("scope","node_id","repeater_item_id").values_list("asset_id","scope","revision_id","node_id","field_path","repeater_item_id"))


@pytest.fixture
def world(media_world, derivative_storage):
    w = media_world
    for actor in (w.actor,w.both):
        grant_cms_role(site=w.a,user=actor,role=ContentRole.AUTHOR)
    first=asset(w,derivative_storage);second=asset(w,derivative_storage)
    page=Page.objects.create(site=w.a,title="Visual draft",slug="visual-draft",metadata={"campaign":"Preserve me","visual_layout":tree(first)},created_by=w.actor,updated_by=w.actor)
    return SimpleNamespace(w=w,first=first,second=second,page=page,storage=derivative_storage)


def test_complete_tree_round_trip_keeps_order_and_reference_identity(world):
    w,page=world.w,world.page
    api=client(w.actor);url=endpoint(w.a,page)
    loaded=api.get(url);layout=tree(world.second,world.first)
    layout["rows"][0]["columns"][1]["children"][0]["props"]["items"].reverse()
    saved=api.patch(url,{"visual_layout":layout},format="json",HTTP_IF_MATCH=loaded["ETag"])
    assert saved.status_code == 200,saved.data
    assert saved["ETag"] != loaded["ETag"]
    assert saved["Cache-Control"] == "private, no-store"
    reloaded=api.get(url)
    assert reloaded.json()["metadata"] == {"campaign":"Preserve me","visual_layout":layout}
    assert reloaded.json()["revision_number"] == loaded.json()["revision_number"]+1
    assert reloaded["ETag"] == saved["ETag"]
    refs=inventory(page)
    assert len(refs)==3
    assert {entry[3:] for entry in refs} == {("slider-1","props.items.asset_id","slide-1"),("slider-1","props.items.asset_id","slide-2"),("nested-image","props.asset_id","")}
    assert all(entry[2] == ContentRevision.objects.filter(content=page).latest("revision_number").pk for entry in refs)


@pytest.mark.parametrize("attack", ["script-url", "style-token", "unexpected-property"])
def test_hostile_visual_writes_are_rejected_atomically(world, attack):
    page, w = world.page, world.w
    layout = tree(world.first)
    widget = {"id":"hostile-link", "type":"button", "props":{"label":"Safe label", "href":"/about"}}
    layout["rows"][0]["columns"][0]["children"].append(widget)
    if attack == "script-url":
        widget["props"]["href"] = "javascript:alert(1)"
    elif attack == "style-token":
        widget["style"] = {"tone":"url(javascript:alert(1))"}
    else:
        widget["props"]["onClick"] = "alert(1)"
    before = (copy.deepcopy(page.metadata), page.revision_number, inventory(page))
    response = client(w.actor).patch(endpoint(w.a,page), {"visual_layout":layout},
                                     format="json", HTTP_IF_MATCH=content_etag(page))
    assert response.status_code == 400
    assert response.json()["error"]["details"]["fields"]
    page.refresh_from_db()
    assert (page.metadata, page.revision_number, inventory(page)) == before


def test_public_snapshot_independent_of_visual_working_draft(world,settings):
    w=world.w;settings.ALLOWED_HOSTS=["testserver",".uog.edu.et"]
    activate_site(w.a.pk)
    SiteDomain.objects.create(site=w.a,hostname="visual-draft.uog.edu.et",status="ACTIVE",is_primary=True)
    page=world.page
    page.metadata={"campaign":"Preserve me"};page.blocks=[{"type":"heading","level":2,"text":"Original published body"}];page.save()
    publish(page);page.refresh_from_db()
    api=client(w.actor);anon=Client();public_url="/api/v1/site-context/pages/visual-draft/"
    before=anon.get(public_url,HTTP_HOST="visual-draft.uog.edu.et")
    assert before.status_code == 200
    snapshot=PublishedContentSnapshot.objects.get(content=page)
    payload=copy.deepcopy(snapshot.payload);live_inventory=inventory(page)
    opened=api.post(f"/api/v1/sites/{w.a.pk}/pages/{page.pk}/working-draft/",{},format="json",HTTP_IF_MATCH=content_etag(page))
    assert opened.status_code == 201,opened.data
    draft=Page.objects.get(pk=opened.data["id"])
    saved=api.patch(endpoint(w.a,draft),{"visual_layout":tree(world.second)},format="json",HTTP_IF_MATCH=opened["ETag"])
    assert saved.status_code == 200,saved.data
    assert saved.data["blocks"] == []
    after=anon.get(public_url,HTTP_HOST="visual-draft.uog.edu.et")
    assert after.json() == before.json()
    snapshot.refresh_from_db();assert snapshot.payload == payload
    assert inventory(page)==live_inventory
    page.refresh_from_db();assert page.metadata == {"campaign":"Preserve me"}
    assert page.blocks == [{"type":"heading","level":2,"text":"Original published body"}]
    denied=api.patch(endpoint(w.a,page),{"visual_layout":tree(world.second)},format="json",HTTP_IF_MATCH=content_etag(page))
    assert denied.status_code == 400 and "status" in denied.json()["error"]["details"]["fields"]


def test_foreign_item_failure_has_identity_and_rolls_back_everything(world):
    w,page=world.w,world.page;foreign=upload(w,world.storage,site=w.b,actor=w.both);process_asset(foreign.pk,storage=world.storage)
    before=(copy.deepcopy(page.metadata),page.revision_number,inventory(page),ContentRevision.objects.filter(content=page).count())
    response=client(w.actor).patch(endpoint(w.a,page),{"visual_layout":tree(world.second,foreign)},format="json",HTTP_IF_MATCH=content_etag(page))
    assert response.status_code == 400,response.data
    details=response.json()["error"]["details"]
    location=details["nodes"][0]
    assert location["node_id"] == "slider-1" and location["item_id"] == "slide-2" and location["item_index"] == 1
    assert location["path"].endswith(".props.items[1].asset_id")
    page.refresh_from_db()
    assert (page.metadata,page.revision_number,inventory(page),ContentRevision.objects.filter(content=page).count()) == before


def test_two_editor_sessions_one_winner_no_stale_slider_or_inventory(world):
    w,page=world.w,world.page;barrier=Barrier(2);etag=content_etag(page)
    first=tree(world.second);second=tree(world.first,world.second)
    first["rows"][0]["columns"][1]["children"][0]["props"]["items"][0]["alt"]="Editor A alt"
    second["rows"][0]["columns"][1]["children"][0]["props"]["items"][0]["caption"]="Editor B caption"
    def save(actor,layout):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            response=client(actor).patch(endpoint(w.a,page),{"visual_layout":layout},format="json",HTTP_IF_MATCH=etag)
            return response.status_code,layout,response.json()
        finally:connections.close_all()
    with ThreadPoolExecutor(max_workers=2) as pool:
        a=pool.submit(save,w.actor,first);b=pool.submit(save,w.both,second)
        results=[a.result(timeout=30),b.result(timeout=30)]
    assert sorted(result[0] for result in results) == [200,409]
    winner=next(result for result in results if result[0]==200)
    page.refresh_from_db();assert page.metadata["visual_layout"] == winner[1]
    assert page.revision_number == 2
    assert ContentRevision.objects.filter(content=page).count() == 2
    expected={(item["asset_id"],item["id"]) for item in winner[1]["rows"][0]["columns"][1]["children"][0]["props"]["items"]}
    actual={(str(row.asset_id),row.repeater_item_id) for row in MediaUsage.objects.filter(page=page,node_id="slider-1")}
    assert actual == expected
    assert all(entry[2] == ContentRevision.objects.filter(content=page).latest("revision_number").pk for entry in inventory(page))


def test_revision_inventory_failure_after_insert_rolls_back_page_and_references(world,monkeypatch):
    from apps.cms.services import revisions
    w,page=world.w,world.page
    before=(copy.deepcopy(page.metadata),page.revision_number,inventory(page),ContentRevision.objects.filter(content=page).count())
    original=revisions.create_content_revision
    def broken(*args,**kwargs):
        original(*args,**kwargs)
        assert MediaUsage.objects.filter(page=page,asset=world.second).exists()
        raise IntegrityError("Injected failure after revision and inventory writes")
    monkeypatch.setattr(revisions,"create_content_revision",broken)
    with pytest.raises(IntegrityError):
        save_visual_draft(site_id=w.a.pk,page_id=page.pk,actor=w.actor,if_match=content_etag(page),visual_layout=tree(world.second))
    page.refresh_from_db()
    assert (page.metadata,page.revision_number,inventory(page),ContentRevision.objects.filter(content=page).count()) == before


def test_preconditions_scoping_and_legacy_round_trip(world):
    w=world.w;api=client(w.actor);url=endpoint(w.a,world.page)
    assert api.patch(url,{"visual_layout":tree(world.second)},format="json").status_code == 428
    assert api.patch(url,{"visual_layout":tree(world.second)},format="json",HTTP_IF_MATCH='"stale"').status_code == 409
    assert api.get(endpoint(w.b,world.page)).status_code in (403,404)
    legacy=Page.objects.create(site=w.a,title="Legacy",slug="legacy-flat",blocks=[{"type":"heading","text":"Old heading","level":2}],created_by=w.actor,updated_by=w.actor)
    loaded=api.get(endpoint(w.a,legacy));assert "visual_layout" not in loaded.data["metadata"]
    body=loaded.json()["blocks"];body[0]["text"]="Saved legacy heading"
    result=api.patch(f"/api/v1/sites/{w.a.pk}/pages/{legacy.pk}/",{"blocks":body},format="json",HTTP_IF_MATCH=loaded["ETag"])
    assert result.status_code == 200,result.data
    assert api.get(endpoint(w.a,legacy)).json()["blocks"] == body
    # Switching to the visual contract is an explicit full-body replacement;
    # the last flat body remains available in its prior immutable revision.
    visual=api.patch(endpoint(w.a,legacy),{"visual_layout":tree(world.first)},format="json",HTTP_IF_MATCH=result["ETag"])
    assert visual.status_code == 200 and visual.data["blocks"] == []
    assert ContentRevision.objects.filter(content=legacy,snapshot__blocks=body).exists()


def test_validation_errors_bind_nodes_and_keep_original_draft(world):
    w,page=world.w,world.page;api=client(w.actor);url=endpoint(w.a,page)
    before=(copy.deepcopy(page.metadata),page.revision_number,inventory(page))
    bad=tree(world.second)
    bad["rows"][0]["columns"][1]["children"][0]["props"]["items"][0]["alt"]=123
    response=api.patch(url,{"visual_layout":bad},format="json",HTTP_IF_MATCH=content_etag(page))
    assert response.status_code == 400
    bound=response.json()["error"]["details"]["nodes"][0]
    assert (bound["node_id"],bound["item_id"],bound["item_index"]) == ("slider-1","slide-1",0)
    assert bound["path"].endswith(".props.items[0].alt")
    invalid_id=tree(world.second)
    invalid_id["rows"][0]["columns"][1]["children"][0]["props"]["items"][0]["id"]=123
    id_error=api.patch(url,{"visual_layout":invalid_id},format="json",HTTP_IF_MATCH=content_etag(page))
    id_binding=id_error.json()["error"]["details"]["nodes"][0]
    assert (id_binding["node_id"],id_binding["item_id"],id_binding["item_index"]) == ("slider-1",None,0)
    missing=api.patch(url,{},format="json",HTTP_IF_MATCH=content_etag(page))
    assert missing.status_code == 400 and "visual_layout" in missing.json()["error"]["details"]["fields"]
    page.refresh_from_db();assert (page.metadata,page.revision_number,inventory(page)) == before


def test_reviewer_cannot_save_and_disabled_pages_rejects_draft_writes(world):
    from apps.sites.models import Module
    w,page=world.w,world.page
    reader=get_user_model().objects.create_user(username="visual-reviewer")
    grant_cms_role(site=w.a,user=reader,role=ContentRole.REVIEWER)
    api=client(reader);url=endpoint(w.a,page)
    assert api.get(url).status_code == 200
    assert api.patch(url,{"visual_layout":tree(world.second)},format="json",HTTP_IF_MATCH=content_etag(page)).status_code == 403
    module=Module.objects.get(code="VISUAL_BUILDER");module.is_enabled=False;module.save(update_fields=["is_enabled"])
    result=client(w.actor).patch(url,{"visual_layout":tree(world.second)},format="json",HTTP_IF_MATCH=content_etag(page))
    assert result.status_code == 400 and "module_disabled" in json.dumps(result.json())
    page.refresh_from_db();assert page.revision_number == 1


def test_working_draft_open_rechecks_published_version_inside_service_lock(world):
    page=world.page;old=content_etag(page)
    publish(page);page.refresh_from_db()
    before=Page.objects.count()
    with pytest.raises(ContentEditConflict):
        open_working_draft(page,actor=world.w.actor,if_match=old)
    assert Page.objects.count() == before
