import copy
import json
from pathlib import Path
import pytest
from django.core.exceptions import ValidationError
from django.db import connection, IntegrityError, transaction
from apps.cms.layout_contract import validate_layout, REGISTRY
from apps.cms.models import Page

FIXTURES = json.loads((Path(__file__).parents[1] / "schemas/layout/fixtures.json").read_text())


@pytest.mark.parametrize("case", FIXTURES, ids=lambda case: case["name"])
def test_shared_contract_cases(case):
    original = copy.deepcopy(case["layout"])
    if case["valid"]:
        assert validate_layout(original) == original
    else:
        with pytest.raises(ValidationError) as caught:
            validate_layout(original)
        assert all(path.startswith("metadata.visual_layout") for path in caught.value.message_dict)
    assert original == case["layout"]


def test_exact_product_catalog():
    assert len(REGISTRY) == len({entry["type"] for entry in REGISTRY}) == 43


@pytest.mark.django_db
@pytest.mark.parametrize("case", FIXTURES, ids=lambda case: case["name"])
def test_database_contract_cases(case):
    with connection.cursor() as cursor:
        cursor.execute("SELECT cms_layout_shape_valid(%s::jsonb,%s::jsonb)", [json.dumps(case["layout"]), (Path(__file__).parents[1] / "schemas/layout/layout-v1.schema.json").read_text()])
        # Structural rules are shared. Duplicate IDs and column counts are
        # additional document-wide rules in the trigger below.
        if case["name"] not in {"duplicate-id", "ratio-column-mismatch"}:
            assert cursor.fetchone()[0] is case["valid"]


@pytest.mark.django_db
def test_page_round_trip_and_raw_write_guard(sites):
    layout = copy.deepcopy(FIXTURES[0]["layout"])
    layout["rows"][0]["columns"][1]["children"][0]["props"]["items"] = []
    page = Page.objects.create(site=sites[0], title="Visual", slug="visual-contract", metadata={"visual_layout": layout})
    page.refresh_from_db()
    assert page.metadata["visual_layout"] == layout
    assert page.blocks == [] and page.blocks_version == "1"
    bad = copy.deepcopy(layout); bad["rows"][0]["columns"][1]["id"] = "column-1"
    with pytest.raises(IntegrityError) as caught, transaction.atomic():
        from django.db.models import F
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('cms.content_revision_write','on',true)")
        Page.objects.filter(pk=page.pk).update(metadata={"visual_layout": bad},revision_number=F("revision_number")+1)
    assert "Visual layout node IDs" in str(caught.value)
    page.refresh_from_db(); assert page.metadata["visual_layout"] == layout
    legacy = Page.objects.create(site=sites[0], title="Legacy", slug="legacy-contract", blocks=[{"type":"heading","level":2,"text":"Still readable"}])
    legacy.refresh_from_db(); assert "visual_layout" not in legacy.metadata


def test_payload_and_total_node_boundaries():
    layout = copy.deepcopy(FIXTURES[0]["layout"])
    layout["rows"] *= 50
    with pytest.raises(ValidationError): validate_layout(layout)
    layout = {"schema_version":1,"rows":[{"id":"r","type":"section","ratios":[100],"columns":[{"id":"c","type":"column","children":[{"id":f"w{i}","type":"editor","props":{"html":"x"*20000}} for i in range(20)]}]}]}
    with pytest.raises(ValidationError, match="bytes"): validate_layout(layout)


def test_responsive_overrides_accept_approved_tokens_and_reject_unknown():
    valid = next(case for case in FIXTURES if case["name"] == "responsive-spacing-stack")
    assert validate_layout(copy.deepcopy(valid["layout"])) == valid["layout"]
    for name in ("unknown-breakpoint", "unknown-responsive-property", "widget-stack-forbidden"):
        bad = next(case for case in FIXTURES if case["name"] == name)
        with pytest.raises(ValidationError) as caught:
            validate_layout(copy.deepcopy(bad["layout"]))
        assert all(path.startswith("metadata.visual_layout") for path in caught.value.message_dict)
    legacy = copy.deepcopy(FIXTURES[0]["layout"])
    assert "responsive" not in legacy["rows"][0]
    assert validate_layout(legacy) == legacy


@pytest.mark.django_db(transaction=True)
def test_upgrade_from_pre_visual_contract_preserves_legacy_page():
    from django.db.migrations.executor import MigrationExecutor
    from apps.organizations.models import OrganizationType, OrganizationUnit
    from apps.sites.models import Site
    executor=MigrationExecutor(connection)
    latest=executor.loader.graph.leaf_nodes()
    # Create a complete, revisioned legacy fixture through its domain service
    # before rolling back. Today's Site ORM includes later settings columns.
    kind,_=OrganizationType.objects.get_or_create(code="UNIVERSITY",defaults={"name":"University"})
    owner=OrganizationUnit.objects.create(code="LAYOUT-OWNER",name="Layout owner",organization_type=kind)
    site=Site.objects.create(code="LAYOUT-SITE",name="Layout Site",organization_unit=owner)
    page=Page.objects.create(site=site,title="Legacy upgrade",slug="legacy-upgrade",blocks=[{"type":"heading","level":2,"text":"Preserved"}])
    before=(page.blocks,page.blocks_version,page.metadata,page.revision_number)
    try:
        executor.migrate([("cms","0013_media_repeater_blocks")])
        # Read the downgraded baseline through its historical model only.
        historical=executor.loader.project_state([("cms","0013_media_repeater_blocks")]).apps
        HistoricalPage=historical.get_model("cms","Page")
        baseline=HistoricalPage.objects.get(pk=page.pk)
        assert (baseline.blocks,baseline.blocks_version,baseline.metadata,baseline.revision_number)==before
        MigrationExecutor(connection).migrate(latest)
        page=Page.objects.get(pk=page.pk)
        assert (page.blocks,page.blocks_version,page.metadata,page.revision_number)==before
    finally:
        MigrationExecutor(connection).migrate(latest)
