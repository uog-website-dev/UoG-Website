"""Structured content blocks: schema, safety, sizes, order and round-trip.

Evidence for P2-CMS-003 acceptance: block JSON schema validation, malicious
HTML neutralization, unauthorized asset references, size limits (domain and
database backstop), block-order determinism, and schema-version storage.
"""
import json

import pytest
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from pathlib import Path

from apps.cms import blocks as blocks_schema
from apps.cms.models import Page, SiteContent
from apps.cms.services.pages import create_page

pytestmark = pytest.mark.django_db


def _content_blocks(page):
    return page.blocks


def site_of(sites):
    return sites[0]


HEADING = {"type": "heading", "level": 2, "text": "Welcome"}
PARAGRAPH = {"type": "paragraph", "html": "<p>Hello <strong>world</strong>.</p>"}
IMAGE = {"type": "image", "ref": "shared/informatics/hero.png", "alt": "Campus"}
BUTTON = {"type": "button", "label": "Apply", "href": "/admission"}
ORDERED = {"type": "list", "style": "ordered", "items": ["First", "Second"]}
SECTION = {
    "type": "section", "heading": "Highlights", "children": [PARAGRAPH, IMAGE],
}


def create_page_with_blocks(site, slug, block_list):
    return create_page(site=site, title="T", slug=slug, blocks=block_list)


def test_blocks_live_on_the_shared_record_every_content_type_inherits():
    # Posts are a future multi-table child; the blocks live on SiteContent,
    # so the (one) blocks schema is reused by Pages and Posts alike.
    fields = {field.name for field in SiteContent._meta.get_fields()}
    assert "blocks" in fields and "blocks_version" in fields
    assert Page._meta.get_field("blocks").column == "blocks"


def test_every_block_type_round_trips_in_saved_order(sites):
    site = site_of(sites)
    payload = [HEADING, PARAGRAPH, IMAGE, BUTTON, ORDERED, SECTION]
    page = create_page_with_blocks(site, "round-trip", payload)
    page.refresh_from_db()
    assert _content_blocks(page) == [
        HEADING, PARAGRAPH, IMAGE, BUTTON, ORDERED, SECTION,
    ]
    assert page.blocks_version == blocks_schema.SCHEMA_VERSION == "1"


def test_payloads_are_normalized_but_order_and_content_persist(sites):
    site = site_of(sites)
    page = create_page_with_blocks(site, "normalize", [
        {"type": "image", "ref": f"  Sites/{site.pk}/hero.png  ", "alt": " h "},
    ])
    normalized = _content_blocks(page)[0]
    assert normalized["ref"] == f"sites/{site.pk}/hero.png"
    assert normalized["alt"] == "h"


def test_unknown_or_malformed_blocks_fail_with_field_level_errors(sites):
    site = site_of(sites)
    with pytest.raises(ValidationError) as error:
        create_page_with_blocks(site, "unknown-type", [
            {"type": "spoiler", "text": "x"},
        ])
    assert "blocks[0]" in error.value.message_dict
    assert "Unknown block type" in error.value.message_dict["blocks[0]"][0]

    with pytest.raises(ValidationError) as error:
        create_page_with_blocks(site, "not-object", ["just text"])
    assert "block must be a JSON object" in error.value.message_dict["blocks[0]"][0]

    with pytest.raises(ValidationError) as error:
        create_page_with_blocks(site, "missing-keys", [{"type": "heading"}])
    assert set(error.value.message_dict) == {
        "blocks[0].level", "blocks[0].text",
    }

    with pytest.raises(ValidationError) as error:
        create_page_with_blocks(site, "unknown-keys", [
            {"type": "heading", "level": 2, "text": "T", "align": "center"},
        ])
    assert "Unsupported block field" in error.value.message_dict["blocks[0].align"][0]

    with pytest.raises(ValidationError) as error:
        create_page_with_blocks(site, "bad-level", [
            {"type": "heading", "level": 1, "text": "T"},
        ])
    assert "level must be 2, 3 or 4" in error.value.message_dict["blocks[0].level"][0]


def test_blocks_must_be_a_list_bounded_by_max_blocks(sites):
    site = site_of(sites)
    with pytest.raises(ValidationError) as error:
        create_page_with_blocks(site, "not-list", {"type": "heading"})
    assert "blocks must be a JSON array" in error.value.message_dict["blocks"][0]
    with pytest.raises(ValidationError) as error:
        create_page_with_blocks(site, "too-many", [HEADING] * (blocks_schema.MAX_BLOCKS + 1))
    assert "at most 100" in error.value.message_dict["blocks"][0]
    boundary = create_page_with_blocks(site, "boundary", [HEADING] * blocks_schema.MAX_BLOCKS)
    assert len(boundary.blocks) == blocks_schema.MAX_BLOCKS


def test_malicious_rich_text_is_sanitized_on_write_and_cannot_execute(sites):
    site = site_of(sites)
    page = create_page_with_blocks(site, "xss", [{
        "type": "paragraph",
        "html": (
            '<p onclick="alert(1)">safe<strong>bold</strong><script>alert(2)</script>'
            "<iframe src=//evil.example></iframe>"
            "<svg><onsvgload>alert(3)</onsvgload></svg>"
            '<a href="javascript:alert(4)">link</a>'
            '<a href="//evil.example">protocol-relative</a>'
            '<a href="https://portal.uog.edu.et" target="_blank">ok</a>'
            "<img src=x onerror=alert(5)>"
            "<style>body{}</style>"
            "</p>"
        ),
    }])
    stored = _content_blocks(page)[0]["html"]
    lowered = stored.lower()
    for payload in ("<script", "onerror", "onclick", "<iframe", "<svg", "<img",
                    "javascript:", "<style"):
        assert payload not in lowered
    assert "safe" in stored and "<strong>" in stored
    assert 'rel="noopener noreferrer"' in stored
    assert 'href="https://portal.uog.edu.et"' in stored
    assert 'href="//evil.example"' not in stored


def test_mutation_via_update_also_persists_the_sanitized_payload(sites):
    site = site_of(sites)
    page = create_page_with_blocks(site, "update-fields", [PARAGRAPH])
    page.blocks = [{
        "type": "paragraph",
        "html": "<p>w<em>航行</em><script>alert(1)</script></p>",
    }]
    page.save(update_fields=["blocks"])
    page.refresh_from_db()
    assert "<script" not in page.blocks[0]["html"]
    assert "航行" in page.blocks[0]["html"]


def test_button_hrefs_follow_the_link_policy(sites):
    site = site_of(sites)
    page = create_page_with_blocks(site, "hrefs", [
        {"type": "button", "label": "A", "href": "  https://uog.edu.et/admission  "},
        {"type": "button", "label": "B", "href": "/about#team"},
        {"type": "button", "label": "C", "href": "mailto:info@uog.edu.et"},
    ])
    hrefs = [block["href"] for block in page.blocks]
    assert hrefs == ["https://uog.edu.et/admission", "/about#team", "mailto:info@uog.edu.et"]

    for href, slug in (
        ("javascript:alert(1)", "href-js"),
        ("data:text/html;base64,AAAA", "href-data"),
        ("//evil.example", "href-protocol-relative"),
        ("/\\evil.example", "href-backslash"),
        ("not a url at all", "href-garbage"),
        ("https://Space In It.example", "href-space"),
        ("https://[broken", "href-malformed"),
    ):
        with pytest.raises(ValidationError) as error:
            create_page_with_blocks(site, slug, [
                {"type": "button", "label": "L", "href": href},
            ])
        assert "href must" in error.value.message_dict["blocks[0].href"][0]


def test_image_references_must_belong_to_an_approved_scope(sites):
    site, other = sites
    page = create_page_with_blocks(site, "asset-scope", [
        {"type": "image", "ref": f"  /SITES/{site.pk}/hero.png ", "alt": "a"},
        {"type": "image", "ref": "shared/logos/seal.png", "alt": "b"},
    ])
    refs = [block["ref"] for block in page.blocks]
    assert refs == [f"sites/{site.pk}/hero.png", "shared/logos/seal.png"]

    for ref, slug in (
        (f"sites/{other.pk}/stolen.png", "foreign-site"),
        ("https://cdn.evil.example/hack.png", "absolute-url"),
        (f"sites/{site.pk}/../../secrets.png", "traversal"),
        (f"\\\\{site.pk}\\file.png", "backslash"),
        (f"sites//{site.pk}/x.png", "double-slash"),
        (f"sites/{site.pk}/" + "x" * 600, "oversize-ref"),
        ("shared/", "no-segment"),
        ("public/whatever.png", "unknown-scope"),
        (f"elevated/{site.pk}/x.png", "elevated-scope"),
    ):
        with pytest.raises(ValidationError) as error:
            create_page_with_blocks(site, slug, [
                {"type": "image", "ref": ref, "alt": "alt"},
            ])
        assert "blocks[0].ref" in error.value.message_dict


def test_sections_cannot_nest_and_deny_empty_children(sites):
    site = site_of(sites)
    with pytest.raises(ValidationError) as error:
        create_page_with_blocks(site, "nested-section", [
            {"type": "section", "children": [
                {"type": "section", "children": [PARAGRAPH]},
            ]},
        ])
    assert "sections cannot nest sections" in error.value.message_dict[
        "blocks[0].children"
    ][0]
    with pytest.raises(ValidationError) as error:
        create_page_with_blocks(site, "empty-section", [
            {"type": "section", "children": []},
        ])
    assert "children must contain" in error.value.message_dict["blocks[0].children"][0]
    # ...but a valid section keeps its normalized children in order
    nested = create_page_with_blocks(site, "good-section", [SECTION])
    assert nested.blocks[0]["children"] == [PARAGRAPH, IMAGE]
    assert len(nested.blocks) == 1
    with pytest.raises(ValidationError) as error:
        create_page_with_blocks(site, "too-many-children", [{
            "type": "section", "children": [HEADING] * (blocks_schema.MAX_BLOCKS + 1),
        }])
    assert "children must contain" in error.value.message_dict["blocks[0].children"][0]


def test_rich_text_and_text_fields_have_size_limits(sites):
    site = site_of(sites)
    with pytest.raises(ValidationError) as error:
        create_page_with_blocks(site, "huge-html", [{
            "type": "paragraph", "html": "<p>" + "x" * (blocks_schema.MAX_RICH_TEXT + 1) + "</p>",
        }])
    assert "at most 20000" in error.value.message_dict["blocks[0].html"][0]
    with pytest.raises(ValidationError) as error:
        create_page_with_blocks(site, "huge-text", [
            {"type": "heading", "level": 3, "text": "y" * 401},
        ])
    assert "at most 400" in error.value.message_dict["blocks[0].text"][0]
    with pytest.raises(ValidationError) as error:
        create_page_with_blocks(site, "huge-serialized-block", [{
            "type": "paragraph", "html": "x" * 13000,
        }])
    assert "exceeds 12288 bytes" in error.value.message_dict["blocks[0]"][0]
    with pytest.raises(ValidationError) as error:
        create_page_with_blocks(site, "empty-after-sanitize", [{
            "type": "paragraph", "html": "<script>alert(1)</script>",
        }])
    assert "empty after sanitization" in error.value.message_dict["blocks[0].html"][0]
    with pytest.raises(ValidationError) as error:
        create_page_with_blocks(site, "many-items", [{
            "type": "list", "style": "ordered", "items": ["x"] * 51,
        }])
    assert "1-50" in error.value.message_dict["blocks[0].items"][0]
    with pytest.raises(ValidationError) as error:
        create_page_with_blocks(site, "no-items", [{
            "type": "list", "style": "ordered", "items": [],
        }])
    assert "1-50" in error.value.message_dict["blocks[0].items"][0]
    too_large_list = [
        {"type": "paragraph", "html": "z" * 2700}
        for _ in range(blocks_schema.MAX_BLOCKS)
    ]
    with pytest.raises(ValidationError) as error:
        create_page_with_blocks(site, "large-total", too_large_list)
    assert "exceeds 262144 bytes" in error.value.message_dict["blocks"][0]


def test_schema_versions_are_stored_and_unsupported_versions_rejected(sites):
    site = site_of(sites)
    page = create_page_with_blocks(site, "versioned", [HEADING])
    assert page.blocks_version == "1"
    with pytest.raises(IntegrityError), transaction.atomic():
        Page.objects.filter(pk=page.pk).update(blocks_version="2")
    page.refresh_from_db()
    assert page.blocks_version == "1"
    page.blocks_version = "9"
    with pytest.raises(ValidationError) as error:
        page.save()
    assert "blocks_version" in error.value.message_dict


def test_database_backstops_the_block_envelope_for_raw_writers(sites):
    site = site_of(sites)
    page = create_page_with_blocks(site, "backstop", [PARAGRAPH])
    page_id = page.pk
    # Unknown element type never reaches disk.
    with pytest.raises(IntegrityError), transaction.atomic():
        Page.objects.filter(pk=page_id).update(blocks=[{"type": "spoiler"}])
    with pytest.raises(IntegrityError), transaction.atomic():
        Page.objects.filter(pk=page_id).update(blocks=["a plain string"])
    # Every element must be an object.
    with pytest.raises(IntegrityError), transaction.atomic():
        Page.objects.filter(pk=page_id).update(blocks=[[HEADING]])
    # One oversize block is refused by the database too.
    oversize = {"type": "paragraph", "html": "<p>" + "x" * blocks_schema.MAX_RICH_TEXT + "</p>"}
    with pytest.raises(IntegrityError), transaction.atomic():
        Page.objects.filter(pk=page_id).update(blocks=[oversize])
    # The whole list may not exceed the total ceiling: one hundred ~2.7 KB
    # paragraphs top 256 KiB while every element stays under its own limit.
    wall = [{"type": "paragraph", "html": "z" * 2700}] * blocks_schema.MAX_BLOCKS
    assert blocks_schema._blocks_json_size(wall) > blocks_schema.MAX_BLOCKS_BYTES
    with pytest.raises(IntegrityError), transaction.atomic():
        Page.objects.filter(pk=page_id).update(blocks=wall)
    with pytest.raises(IntegrityError), transaction.atomic():
        Page.objects.filter(pk=page_id).update(
            blocks=[{"type": "heading", "level": 2, "text": "x"}] * 101,
        )
    page.refresh_from_db()
    assert page.blocks == [PARAGRAPH]


def test_block_order_is_data_and_listed_deterministically(sites):
    site = site_of(sites)
    first = create_page_with_blocks(site, "order-a", [PARAGRAPH, HEADING])
    second = create_page_with_blocks(site, "order-b", [HEADING, PARAGRAPH])
    first.refresh_from_db()
    second.refresh_from_db()
    assert [b["type"] for b in first.blocks] == ["paragraph", "heading"]
    assert [b["type"] for b in second.blocks] == ["heading", "paragraph"]
    assert first.blocks != second.blocks


def test_documented_block_contract_matches_the_domain():
    path = (
        Path(settings.BASE_DIR).parent
        / "docs" / "architecture" / "cms-content-blocks.md"
    )
    text = path.read_text(encoding="utf-8")
    for block_type in sorted(blocks_schema.KNOWN_TYPES):
        assert f'"{block_type}"' in text, f"{block_type} is undocumented"
    assert '"1"' in text
    schema_path = (
        Path(settings.BASE_DIR) / "apps" / "cms" / "schemas"
        / "blocks-v1.schema.json"
    )
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    assert schema["x-content-blocks-version"] == blocks_schema.SCHEMA_VERSION
    assert schema["maxItems"] == blocks_schema.MAX_BLOCKS
    assert schema["x-max-item-serialized-bytes"] == blocks_schema.MAX_BLOCK_BYTES
    assert schema["x-max-serialized-bytes"] == blocks_schema.MAX_BLOCKS_BYTES
    assert set(schema["$defs"]) == blocks_schema.KNOWN_TYPES
    for limit in (blocks_schema.MAX_BLOCKS, blocks_schema.MAX_BLOCK_BYTES,
                  blocks_schema.MAX_BLOCKS_BYTES):
        assert str(limit) in text
    for rule in ("cms_validate_blocks", "content_blocks_element_type"):
        assert rule in text
    # The share-site database constraints repeat the envelope on every row.
    constraint_names = {c.name for c in SiteContent._meta.constraints}
    assert {"content_blocks_array", "content_blocks_version"} <= constraint_names
