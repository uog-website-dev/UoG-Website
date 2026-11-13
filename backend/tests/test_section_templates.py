"""Site-owned section templates: create, insert twice, foreign/media isolation."""
from apps.cms.tests.support import grant_cms_role
import copy
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from rest_framework.test import APIClient

from apps.cms.models import ContentRole, Page, SectionTemplate
from apps.cms.services.working_drafts import content_etag
from apps.cms.services.section_templates import remap_section_ids
from apps.media.services import update_asset

from .test_media_assets import media_world
from .test_media_derivatives import derivative_storage
from .test_media_removal import asset

pytestmark = pytest.mark.django_db(transaction=True)
SAMPLE = json.loads((Path(__file__).parents[1] / "apps/cms/schemas/layout/fixtures.json").read_text())[0]["layout"]


def client(actor):
    api = APIClient()
    api.force_authenticate(actor)
    return api


def section_with_slider(first):
    doc = copy.deepcopy(SAMPLE)
    row = doc["rows"][0]
    # Keep a two-column-like slider section from the fixture's first row.
    slider = next(child for column in row["columns"] for child in column["children"] if child["type"] == "image_slider")
    slider["props"]["items"] = [
        {"id": "slide-1", "asset_id": str(first.pk), "alt": "First slide", "caption": "First caption"},
        {"id": "slide-2", "asset_id": str(first.pk), "alt": "Second slide", "caption": "Second caption"},
    ]
    return row


@pytest.fixture
def world(media_world, derivative_storage):
    w = media_world
    grant_cms_role(site=w.a, user=w.actor, role=ContentRole.AUTHOR)
    grant_cms_role(site=w.b, user=w.actor, role=ContentRole.AUTHOR)
    first = asset(w, derivative_storage)
    page = Page.objects.create(
        site=w.a,
        title="Template target",
        slug="template-target",
        metadata={"visual_layout": {"schema_version": 1, "rows": []}},
        created_by=w.actor,
        updated_by=w.actor,
    )
    other = Page.objects.create(
        site=w.b,
        title="Foreign page",
        slug="foreign-page",
        metadata={"visual_layout": {"schema_version": 1, "rows": []}},
        created_by=w.actor,
        updated_by=w.actor,
    )
    return SimpleNamespace(w=w, first=first, page=page, other=other, storage=derivative_storage)


def test_remap_section_ids_are_unique():
    section = {
        "id": "row",
        "type": "section",
        "ratios": [100],
        "columns": [{
            "id": "col",
            "type": "column",
            "children": [{
                "id": "slider",
                "type": "image_slider",
                "props": {"items": [{"id": "item", "asset_id": "00000000-0000-4000-8000-000000000001", "alt": "A"}]},
            }],
        }],
    }
    clone = remap_section_ids(section)
    assert clone["id"] != section["id"]
    assert clone["columns"][0]["id"] != section["columns"][0]["id"]
    assert clone["columns"][0]["children"][0]["id"] != section["columns"][0]["children"][0]["id"]
    assert clone["columns"][0]["children"][0]["props"]["items"][0]["id"] != section["columns"][0]["children"][0]["props"]["items"][0]["id"]
    assert clone["columns"][0]["children"][0]["props"]["items"][0]["asset_id"] == section["columns"][0]["children"][0]["props"]["items"][0]["asset_id"]


def test_save_and_insert_twice_yields_independent_copies(world):
    w, page = world.w, world.page
    api = client(w.actor)
    section = section_with_slider(world.first)
    created = api.post(f"/api/v1/sites/{w.a.pk}/section-templates/", {"name": "Slider band", "section": section}, format="json")
    assert created.status_code == 201, created.data
    template_id = created.json()["id"]
    assert created.json()["version"] == 1
    assert created.json()["schema_version"] == 1

    first = api.post(
        f"/api/v1/sites/{w.a.pk}/pages/{page.pk}/visual-draft/insert-template/",
        {"template_id": template_id},
        format="json",
        HTTP_IF_MATCH=content_etag(page),
    )
    assert first.status_code == 200, first.data
    page.refresh_from_db()
    second = api.post(
        f"/api/v1/sites/{w.a.pk}/pages/{page.pk}/visual-draft/insert-template/",
        {"template_id": template_id},
        format="json",
        HTTP_IF_MATCH=first["ETag"],
    )
    assert second.status_code == 200, second.data
    layout = second.json()["metadata"]["visual_layout"]
    assert len(layout["rows"]) == 2
    first_ids = {node["id"] for row in [layout["rows"][0]] for col in row["columns"] for node in [row, col, *col["children"]]}
    second_ids = {node["id"] for row in [layout["rows"][1]] for col in row["columns"] for node in [row, col, *col["children"]]}
    assert first_ids.isdisjoint(second_ids)
    template = SectionTemplate.objects.get(pk=template_id)
    assert template.section["id"] == section["id"]
    # Edit one insertion only.
    layout["rows"][0]["columns"][1]["children"][0]["props"]["items"][0]["caption"] = "Edited first insertion"
    saved = api.patch(
        f"/api/v1/sites/{w.a.pk}/pages/{page.pk}/visual-draft/",
        {"visual_layout": layout},
        format="json",
        HTTP_IF_MATCH=second["ETag"],
    )
    assert saved.status_code == 200, saved.data
    reloaded = api.get(f"/api/v1/sites/{w.a.pk}/pages/{page.pk}/visual-draft/")
    rows = reloaded.json()["metadata"]["visual_layout"]["rows"]
    assert rows[0]["columns"][1]["children"][0]["props"]["items"][0]["caption"] == "Edited first insertion"
    assert rows[1]["columns"][1]["children"][0]["props"]["items"][0]["caption"] == "First caption"
    template.refresh_from_db()
    assert template.section["columns"][1]["children"][0]["props"]["items"][0]["caption"] == "First caption"


def test_foreign_template_insert_leaves_layout_unchanged(world):
    w, page = world.w, world.page
    api = client(w.actor)
    foreign = api.post(
        f"/api/v1/sites/{w.b.pk}/section-templates/",
        {"name": "Foreign", "section": section_with_slider(world.first)},
        format="json",
    )
    # Foreign Site asset may fail create; mint a headline-only section for Site B if needed.
    if foreign.status_code != 201:
        foreign = api.post(
            f"/api/v1/sites/{w.b.pk}/section-templates/",
            {
                "name": "Foreign",
                "section": {
                    "id": "foreign-row",
                    "type": "section",
                    "ratios": [100],
                    "columns": [{
                        "id": "foreign-col",
                        "type": "column",
                        "children": [{"id": "foreign-headline", "type": "headline", "props": {"level": 2, "text": "Foreign"}}],
                    }],
                },
            },
            format="json",
        )
    assert foreign.status_code == 201, foreign.data
    before = copy.deepcopy(page.metadata)
    before_revision = page.revision_number
    response = api.post(
        f"/api/v1/sites/{w.a.pk}/pages/{page.pk}/visual-draft/insert-template/",
        {"template_id": foreign.json()["id"]},
        format="json",
        HTTP_IF_MATCH=content_etag(page),
    )
    assert response.status_code == 400
    page.refresh_from_db()
    assert page.metadata == before
    assert page.revision_number == before_revision


def test_retired_media_blocks_insert_without_partial_write(world):
    w, page = world.w, world.page
    api = client(w.actor)
    created = api.post(
        f"/api/v1/sites/{w.a.pk}/section-templates/",
        {"name": "Needs media", "section": section_with_slider(world.first)},
        format="json",
    )
    assert created.status_code == 201, created.data
    update_asset(w.actor, w.a.pk, world.first.pk, changes={"status": "ARCHIVED"})
    before = copy.deepcopy(page.metadata)
    before_revision = page.revision_number
    response = api.post(
        f"/api/v1/sites/{w.a.pk}/pages/{page.pk}/visual-draft/insert-template/",
        {"template_id": created.json()["id"]},
        format="json",
        HTTP_IF_MATCH=content_etag(page),
    )
    assert response.status_code == 400
    assert response.json()["error"]["details"]["fields"]
    page.refresh_from_db()
    assert page.metadata == before
    assert page.revision_number == before_revision


def test_retire_template_preserves_already_inserted_content(world):
    w, page = world.w, world.page
    api = client(w.actor)
    created = api.post(
        f"/api/v1/sites/{w.a.pk}/section-templates/",
        {
            "name": "Headline band",
            "section": {
                "id": "row-h",
                "type": "section",
                "ratios": [100],
                "columns": [{
                    "id": "col-h",
                    "type": "column",
                    "children": [{"id": "headline-h", "type": "headline", "props": {"level": 2, "text": "Reusable"}}],
                }],
            },
        },
        format="json",
    )
    assert created.status_code == 201, created.data
    inserted = api.post(
        f"/api/v1/sites/{w.a.pk}/pages/{page.pk}/visual-draft/insert-template/",
        {"template_id": created.json()["id"]},
        format="json",
        HTTP_IF_MATCH=content_etag(page),
    )
    assert inserted.status_code == 200, inserted.data
    retired = api.patch(
        f"/api/v1/sites/{w.a.pk}/section-templates/{created.json()['id']}/",
        {"status": "RETIRED"},
        format="json",
    )
    assert retired.status_code == 200
    page.refresh_from_db()
    assert page.metadata["visual_layout"]["rows"][0]["columns"][0]["children"][0]["props"]["text"] == "Reusable"
    blocked = api.post(
        f"/api/v1/sites/{w.a.pk}/pages/{page.pk}/visual-draft/insert-template/",
        {"template_id": created.json()["id"]},
        format="json",
        HTTP_IF_MATCH=inserted["ETag"],
    )
    assert blocked.status_code == 400
