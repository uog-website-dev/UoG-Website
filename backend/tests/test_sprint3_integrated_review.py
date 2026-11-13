"""Sprint 3 integrated release path: upload through public homepage on two Sites.

Seeded Informatics/Medicine-style Sites, RBAC profiles, visual layout matrix widgets,
foreign-ID rejection, module disable/re-enable, draft races, cache isolation and
safe deletion of a published Slider image. Medicine remains unchanged while
Informatics advances through the release path.
"""
from __future__ import annotations
from apps.cms.tests.support import grant_cms_role

import copy
import io
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from types import SimpleNamespace

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import close_old_connections, connections
from django.test import Client
from rest_framework.test import APIClient

from apps.audit.models import AuditEvent
from apps.authorization.models import Role, UserRoleAssignment
from apps.cms.layout_contract import REGISTRY, validate_layout
from apps.cms.models import (
    ContentRole,
    Page,
    PublishedContentSnapshot,
)
from apps.cms.services.homepage import assign_homepage
from apps.cms.services.publication_cache import current_publication_version
from apps.cms.services.working_drafts import content_etag
from apps.cms.tests.support import transition_with_site_role
from apps.media.models import MediaUsage
from apps.media.removal import remove_asset
from apps.media.uploads import process_asset, upload_asset
from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.sites.api.access import Conflict
from apps.sites.models import Module, Site, SiteDomain
from apps.sites.services.lifecycle import activate_site
from apps.sites.services.modules import disable_module_for_site, enable_module_for_site

from .test_media_derivatives import DerivativeStorage
from .test_media_uploads import png

pytestmark = pytest.mark.django_db(transaction=True)

FIXTURES = json.loads(
    (Path(__file__).parents[1] / "apps/cms/schemas/layout/fixtures.json").read_text()
)
MATRIX_NAMES = (
    "catalog-contact_form",
    "catalog-loop_grid",
    "catalog-taxonomy_filter",
    "catalog-site_logo",
    "catalog-post_title",
    "catalog-post_excerpt",
)


def _host(site, label):
    activate_site(site.pk)
    hostname = f"{label}-{site.pk}.uog.edu.et"
    SiteDomain.objects.create(
        site=site, hostname=hostname, status="ACTIVE", is_primary=True
    )
    return hostname


def _publish(page, prefix):
    for action in ("submit", "approve", "publish"):
        actor = get_user_model().objects.create_user(
            username=f"{prefix}-{action}-{uuid.uuid4().hex[:8]}"
        )
        transition_with_site_role(page, action, actor)
    page.refresh_from_db()
    return page


def _client(actor):
    api = APIClient()
    api.force_authenticate(actor)
    return api


@pytest.fixture
def storage(monkeypatch):
    result = DerivativeStorage()
    monkeypatch.setattr("apps.media.uploads.ObjectStorage", lambda: result)
    monkeypatch.setattr("apps.media.delivery.ObjectStorage", lambda: result)
    monkeypatch.setattr("apps.media.uploads.enqueue", lambda _: None)
    monkeypatch.setattr("apps.media.removal.enqueue_cleanup", lambda _: None)
    return result


@pytest.fixture
def review_world(storage, settings):
    """Two Sites, RBAC seed, MEDIA+PAGES modules, ready image on Informatics."""
    settings.ALLOWED_HOSTS = ["testserver", ".uog.edu.et", "*"]
    call_command("seed_rbac", verbosity=0)
    kind, _ = OrganizationType.objects.get_or_create(
        code="UNIVERSITY", defaults={"name": "University"}
    )
    owner = OrganizationUnit.objects.create(
        code=f"S3-{uuid.uuid4().hex[:8]}",
        name="Sprint3 Review University",
        organization_type=kind,
    )
    informatics = Site.objects.create(
        organization_unit=owner, code=f"INFO-{uuid.uuid4().hex[:6]}", name="Informatics"
    )
    medicine = Site.objects.create(
        organization_unit=owner, code=f"MED-{uuid.uuid4().hex[:6]}", name="Medicine"
    )
    admin = get_user_model().objects.create_user(username=f"s3-admin-{uuid.uuid4().hex[:6]}")
    editor = get_user_model().objects.create_user(username=f"s3-editor-{uuid.uuid4().hex[:6]}")
    reviewer = get_user_model().objects.create_user(username=f"s3-reviewer-{uuid.uuid4().hex[:6]}")
    publisher = get_user_model().objects.create_user(username=f"s3-publisher-{uuid.uuid4().hex[:6]}")
    for user, role in (
        (admin, "site-administrator"),
        (editor, "editor"),
        (reviewer, "reviewer"),
        (publisher, "publisher"),
    ):
        for site in (informatics, medicine):
            UserRoleAssignment.objects.create(
                user=user,
                role=Role.objects.get(code=role),
                scope="SITE",
                site=site,
                organization=owner,
            )
    for site, role, user in (
        (informatics, ContentRole.AUTHOR, editor),
        (informatics, ContentRole.REVIEWER, reviewer),
        (informatics, ContentRole.PUBLISHER, publisher),
        (medicine, ContentRole.AUTHOR, editor),
        (medicine, ContentRole.REVIEWER, reviewer),
        (medicine, ContentRole.PUBLISHER, publisher),
    ):
        grant_cms_role(site=site, user=user, role=role)

    from django.db import connection
    with connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO sites_module_implementation(code) "
            "VALUES ('MEDIA'), ('PAGES'), ('VISUAL_BUILDER') ON CONFLICT DO NOTHING"
        )
    for code, name in (("MEDIA", "Media"), ("PAGES", "Pages"), ("VISUAL_BUILDER", "Visual Page Builder")):
        module, _ = Module.objects.get_or_create(
            code=code,
            defaults={"name": name, "description": name, "status": "IMPLEMENTED", "is_enabled": True},
        )
        module.is_enabled = True
        module.status = "IMPLEMENTED"
        module.save(update_fields=("is_enabled", "status"))
    # PAGES before VISUAL_BUILDER — builder depends on Pages on the same Site.
    for site in (informatics, medicine):
        enable_module_for_site(site.pk, Module.objects.get(code="MEDIA").pk)
        enable_module_for_site(site.pk, Module.objects.get(code="PAGES").pk)
        enable_module_for_site(site.pk, Module.objects.get(code="VISUAL_BUILDER").pk)

    asset = upload_asset(
        editor,
        informatics.pk,
        io.BytesIO(png()),
        filename="informatics-hero.png",
        request_key=uuid.uuid4(),
        storage=storage,
    )
    assert process_asset(asset.pk, storage=storage).status == "READY"

    medicine_layout = {
        "schema_version": 1,
        "rows": [{
            "id": "med-row",
            "type": "section",
            "ratios": [100],
            "columns": [{
                "id": "med-col",
                "type": "column",
                "children": [{
                    "id": "med-heading",
                    "type": "headline",
                    "props": {"text": "Medicine independent root", "level": 2},
                }],
            }],
        }],
    }
    medicine_page = _publish(
        Page.objects.create(
            site=medicine,
            title="Medicine home",
            slug="home",
            metadata={"visual_layout": medicine_layout},
            created_by=editor,
            updated_by=editor,
        ),
        "med",
    )
    assign_homepage(site_id=medicine.pk, page_id=medicine_page.pk, actor=admin)

    return SimpleNamespace(
        informatics=informatics,
        medicine=medicine,
        admin=admin,
        editor=editor,
        reviewer=reviewer,
        publisher=publisher,
        asset=asset,
        storage=storage,
        medicine_page=medicine_page,
        host_a=_host(informatics, "informatics"),
        host_b=_host(medicine, "medicine"),
        pages_module=Module.objects.get(code="PAGES"),
    )


def release_layout(asset_id, slide_text="Informatics slide"):
    """60/40 row, Image Slider with asset, contact form, taxonomy loop grid, site + post identity."""
    return {
        "schema_version": 1,
        "rows": [
            {
                "id": "hero-row",
                "type": "section",
                "ratios": [60, 40],
                "columns": [
                    {
                        "id": "hero-main",
                        "type": "column",
                        "children": [
                            {
                                "id": "welcome",
                                "type": "headline",
                                "props": {"text": "Informatics release", "level": 2},
                            },
                            {
                                "id": "hero-slider",
                                "type": "image_slider",
                                "props": {
                                    "items": [{
                                        "id": "slide-1",
                                        "asset_id": str(asset_id),
                                        "alt": "Campus hero",
                                        "caption": slide_text,
                                    }],
                                },
                            },
                        ],
                    },
                    {
                        "id": "hero-side",
                        "type": "column",
                        "children": [
                            {
                                "id": "contact",
                                "type": "contact_form",
                                "props": {
                                    "form_code": "campus-contact",
                                    "submit_label": "Send",
                                },
                            },
                            {
                                "id": "side-image",
                                "type": "image",
                                "props": {
                                    "asset_id": str(asset_id),
                                    "alt": "Campus mark",
                                },
                            },
                        ],
                    },
                ],
            },
            {
                "id": "feed-row",
                "type": "section",
                "ratios": [100],
                "columns": [{
                    "id": "feed-col",
                    "type": "column",
                    "children": [
                        {
                            "id": "news-loop",
                            "type": "loop_grid",
                            "props": {
                                "source": "posts",
                                "limit": 6,
                                "category": "campus-news",
                            },
                        },
                        {
                            "id": "tax-filter",
                            "type": "taxonomy_filter",
                            "props": {"taxonomy_code": "topics", "limit": 8},
                        },
                        {"id": "site-mark", "type": "site_logo", "props": {}},
                        {"id": "post-heading", "type": "post_title", "props": {}},
                    ],
                }],
            },
        ],
    }


def test_widget_contract_matrix_covers_review_widgets():
    assert len(REGISTRY) == 43
    by_name = {case["name"]: case for case in FIXTURES}
    for name in MATRIX_NAMES:
        case = by_name[name]
        assert case["valid"] is True
        assert validate_layout(copy.deepcopy(case["layout"])) == case["layout"]
    # Contact form rejects empty form_code; loop grid rejects unknown source.
    bad_contact = copy.deepcopy(by_name["catalog-contact_form"]["layout"])
    bad_contact["rows"][0]["columns"][0]["children"][0]["props"]["form_code"] = ""
    with pytest.raises(ValidationError):
        validate_layout(bad_contact)
    bad_loop = copy.deepcopy(by_name["catalog-loop_grid"]["layout"])
    bad_loop["rows"][0]["columns"][0]["children"][0]["props"]["source"] = "foreign-api"
    with pytest.raises(ValidationError):
        validate_layout(bad_loop)


def test_release_path_upload_through_public_homepage_keeps_medicine_independent(review_world):
    w = review_world
    anon = Client()
    medicine_before = anon.get("/api/v1/site-context/homepage/", HTTP_HOST=w.host_b)
    assert medicine_before.status_code == 200
    medicine_body = medicine_before.json()
    medicine_version = medicine_before["X-Publication-Version"]
    medicine_generation = current_publication_version(w.medicine.pk, w.medicine.default_language)

    layout = release_layout(w.asset.pk)
    page = Page.objects.create(
        site=w.informatics,
        title="Informatics release",
        slug="release",
        metadata={"visual_layout": layout},
        created_by=w.editor,
        updated_by=w.editor,
        blocks=[],
    )
    # Role handoff: editor → reviewer preview → publisher publish.
    submit = _client(w.editor).post(
        f"/api/v1/sites/{w.informatics.pk}/pages/{page.pk}/workflow/",
        {"action": "submit"},
        format="json",
    )
    assert submit.status_code == 200, submit.data
    page.refresh_from_db()
    preview = _client(w.reviewer).get(
        f"/api/v1/sites/{w.informatics.pk}/pages/{page.pk}/preview/"
    )
    assert preview.status_code == 200 and "no-store" in preview["Cache-Control"]
    assert "private" in preview["Cache-Control"]
    approve = _client(w.reviewer).post(
        f"/api/v1/sites/{w.informatics.pk}/pages/{page.pk}/workflow/",
        {"action": "approve"},
        format="json",
        HTTP_IF_MATCH=preview["ETag"],
    )
    assert approve.status_code == 200, approve.data
    page.refresh_from_db()
    publish = _client(w.publisher).post(
        f"/api/v1/sites/{w.informatics.pk}/pages/{page.pk}/workflow/",
        {"action": "publish"},
        format="json",
        HTTP_IF_MATCH=content_etag(page),
    )
    assert publish.status_code == 200, publish.data
    page.refresh_from_db()
    assert PublishedContentSnapshot.objects.filter(content=page).exists()
    assert MediaUsage.objects.filter(asset=w.asset, scope="PUBLIC").exists()

    assign = _client(w.admin).post(
        f"/api/v1/sites/{w.informatics.pk}/pages/{page.pk}/homepage/",
        {},
        format="json",
    )
    assert assign.status_code == 200, assign.data
    event = (
        AuditEvent.objects.filter(action="SITE_HOMEPAGE_ASSIGNED", entity_id=str(w.informatics.pk))
        .order_by("-id")
        .first()
    )
    assert event is not None and event.actor_id == str(w.admin.pk)

    root = anon.get("/api/v1/site-context/homepage/", HTTP_HOST=w.host_a)
    assert root.status_code == 200
    body = root.json()
    assert body["title"] == "Informatics release"
    assert body["metadata"]["visual_layout"]["rows"][0]["ratios"] == [60, 40]
    assert "Informatics slide" in str(body["metadata"]["visual_layout"])
    assert str(w.asset.pk) in str(body["metadata"]["visual_layout"])
    media = anon.get(f"/api/v1/site-context/media/{w.asset.pk}/", HTTP_HOST=w.host_a)
    assert media.status_code == 200
    assert anon.get(f"/api/v1/site-context/media/{w.asset.pk}/", HTTP_HOST=w.host_b).status_code == 404

    medicine_after = anon.get("/api/v1/site-context/homepage/", HTTP_HOST=w.host_b)
    assert medicine_after.json() == medicine_body
    assert medicine_after["X-Publication-Version"] == medicine_version
    assert current_publication_version(w.medicine.pk, w.medicine.default_language) == medicine_generation
    assert "Medicine independent root" in str(medicine_after.json()["metadata"]["visual_layout"])
    assert "Informatics slide" not in str(medicine_after.json()["metadata"]["visual_layout"])

    # Dashboard / Site context for Informatics reflects assignment; Medicine context stays distinct.
    context_a = anon.get("/api/v1/site-context/", HTTP_HOST=w.host_a)
    context_b = anon.get("/api/v1/site-context/", HTTP_HOST=w.host_b)
    assert context_a.status_code == 200 and context_b.status_code == 200
    assert context_a.json()["site"]["code"] == w.informatics.code
    assert context_b.json()["site"]["code"] == w.medicine.code


def test_negative_foreign_module_race_and_safe_deletion(review_world):
    w = review_world
    foreign = upload_asset(
        w.editor,
        w.medicine.pk,
        io.BytesIO(png()),
        filename="medicine-only.png",
        request_key=uuid.uuid4(),
        storage=w.storage,
    )
    assert process_asset(foreign.pk, storage=w.storage).status == "READY"

    page = Page.objects.create(
        site=w.informatics,
        title="Negative path",
        slug="negative",
        metadata={"visual_layout": release_layout(w.asset.pk)},
        created_by=w.editor,
        updated_by=w.editor,
        blocks=[],
    )
    revision_before = page.revision_number
    metadata_before = copy.deepcopy(page.metadata)
    # Cross-Site asset ID injection rejected; draft unchanged.
    poisoned = release_layout(foreign.pk)
    denied = _client(w.editor).patch(
        f"/api/v1/sites/{w.informatics.pk}/pages/{page.pk}/visual-draft/",
        {"visual_layout": poisoned},
        format="json",
        HTTP_IF_MATCH=content_etag(page),
    )
    assert denied.status_code == 400, denied.data
    page.refresh_from_db()
    assert page.metadata == metadata_before
    assert page.revision_number == revision_before

    # Race: two editors, one winner, no foreign inventory leak.
    barrier = Barrier(2)
    etag = content_etag(page)
    layout_a = release_layout(w.asset.pk, "Race A")
    layout_b = release_layout(w.asset.pk, "Race B")
    second = get_user_model().objects.create_user(username=f"s3-editor-b-{uuid.uuid4().hex[:6]}")
    UserRoleAssignment.objects.create(
        user=second,
        role=Role.objects.get(code="editor"),
        scope="SITE",
        site=w.informatics,
        organization=w.informatics.organization_unit,
    )
    grant_cms_role(
        site=w.informatics, user=second, role=ContentRole.AUTHOR
    )

    def save(actor, layout):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            response = _client(actor).patch(
                f"/api/v1/sites/{w.informatics.pk}/pages/{page.pk}/visual-draft/",
                {"visual_layout": layout},
                format="json",
                HTTP_IF_MATCH=etag,
            )
            return response.status_code
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        left = pool.submit(save, w.editor, layout_a)
        right = pool.submit(save, second, layout_b)
        statuses = sorted([left.result(timeout=30), right.result(timeout=30)])
    assert statuses == [200, 409]
    page.refresh_from_db()
    assert page.revision_number == revision_before + 1
    assert MediaUsage.objects.filter(page=page, asset=foreign).count() == 0

    # Disable Pages module: direct edit rejected; Medicine public root unchanged.
    medicine_before = Client().get("/api/v1/site-context/homepage/", HTTP_HOST=w.host_b).json()
    disable_module_for_site(w.informatics.pk, w.pages_module.pk)
    blocked = _client(w.editor).patch(
        f"/api/v1/sites/{w.informatics.pk}/pages/{page.pk}/visual-draft/",
        {"visual_layout": release_layout(w.asset.pk, "After disable")},
        format="json",
        HTTP_IF_MATCH=content_etag(page),
    )
    assert blocked.status_code == 400
    assert "module_disabled" in json.dumps(blocked.json())
    enable_module_for_site(w.informatics.pk, w.pages_module.pk)
    recovered = _client(w.editor).patch(
        f"/api/v1/sites/{w.informatics.pk}/pages/{page.pk}/visual-draft/",
        {"visual_layout": release_layout(w.asset.pk, "After re-enable")},
        format="json",
        HTTP_IF_MATCH=content_etag(page),
    )
    assert recovered.status_code == 200, recovered.data
    assert Client().get("/api/v1/site-context/homepage/", HTTP_HOST=w.host_b).json() == medicine_before

    # Publish Slider image then attempt deletion — protected while PUBLIC usage exists.
    page.refresh_from_db()
    _publish(page, "neg")
    assert MediaUsage.objects.filter(asset=w.asset, scope="PUBLIC").exists()
    with pytest.raises(Conflict):
        remove_asset(w.admin, w.informatics.pk, w.asset.pk)
    assert MediaUsage.objects.filter(asset=w.asset, scope="PUBLIC").exists()
    public = Client().get(f"/api/v1/site-context/media/{w.asset.pk}/", HTTP_HOST=w.host_a)
    assert public.status_code == 200
