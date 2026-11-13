"""Visual widgets participate in the same private/public inventory as legacy blocks."""
from apps.cms.tests.support import grant_cms_role
import copy
import json
from pathlib import Path
import pytest
from django.core.exceptions import ValidationError
from apps.cms.models import Page
from apps.cms.services.working_drafts import open_working_draft
from apps.media.models import MediaUsage
from apps.media.removal import remove_asset
from apps.sites.api.access import Conflict
from .test_media_assets import media_world
from .test_media_derivatives import derivative_storage
from .test_media_removal import asset, publish

pytestmark = pytest.mark.django_db(transaction=True)
SAMPLE = json.loads((Path(__file__).parents[1] / "apps/cms/schemas/layout/fixtures.json").read_text())[0]["layout"]


def layout_for(row):
    doc = copy.deepcopy(SAMPLE)
    doc["rows"][0]["columns"][1]["children"][0]["props"]["items"][0]["asset_id"] = str(row.pk)
    doc["rows"][0]["columns"][2]["children"].append({"id":"image-2","type":"image","props":{"asset_id":str(row.pk),"alt":"Same image"}})
    return doc


def test_visual_media_inventory_publication_retention_and_removal(media_world, derivative_storage, monkeypatch):
    w=media_world; row=asset(w,derivative_storage)
    monkeypatch.setattr("apps.media.removal.enqueue_cleanup",lambda _:None)
    page=Page.objects.create(site=w.a,title="Visual",slug="visual-media",metadata={"visual_layout":layout_for(row)},created_by=w.actor,updated_by=w.actor)
    uses=MediaUsage.objects.filter(asset=row)
    assert set(uses.values_list("node_id","field_path","repeater_item_id")) == {("slider-1","props.items.asset_id","slide-1"),("image-2","props.asset_id","")}
    publish(page);page.refresh_from_db()
    assert set(uses.values_list("scope",flat=True)) == {"PUBLIC"}
    draft,_=open_working_draft(page,actor=w.actor)
    draft.metadata={"visual_layout":{"schema_version":1,"rows":[]}};draft.save()
    with pytest.raises(Conflict):remove_asset(w.actor,w.a.pk,row.pk)
    publish(draft);page.refresh_from_db()
    assert not uses.exists()
    remove_asset(w.actor,w.a.pk,row.pk)


def test_foreign_visual_media_rejected_before_creating_a_page(media_world, derivative_storage):
    w=media_world; row=asset(w,derivative_storage)
    before=Page.objects.count()
    with pytest.raises(ValidationError) as caught:
        Page.objects.create(site=w.b,title="Foreign",slug="foreign-visual",metadata={"visual_layout":layout_for(row)})
    assert "metadata.visual_layout.rows[0].columns[1].children[0].props.items[0].asset_id" in caught.value.message_dict
    assert Page.objects.count() == before


def test_visual_page_api_rejects_unknown_and_accepts_empty_versioned_document(media_world):
    from rest_framework.test import APIClient
    from apps.cms.models import ContentRole
    grant_cms_role(site=media_world.a,user=media_world.actor,role=ContentRole.AUTHOR)
    client=APIClient();client.force_authenticate(media_world.actor)
    url=f"/api/v1/sites/{media_world.a.pk}/pages/"
    before=Page.objects.count()
    bad=client.post(url,{"title":"Invalid","slug":"bad-visual","metadata":{"visual_layout":{"schema_version":99,"rows":[]}}},format="json")
    assert bad.status_code == 400
    assert "metadata.visual_layout.schema_version" in json.dumps(bad.json())
    assert Page.objects.count() == before
    good=client.post(url,{"title":"Visual","slug":"api-visual","metadata":{"visual_layout":{"schema_version":1,"rows":[]}}},format="json")
    assert good.status_code == 201
    assert good.json()["metadata"]["visual_layout"] == {"schema_version":1,"rows":[]}
