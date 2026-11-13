"""PostgreSQL identity, two-Site isolation, placements and upgrade rehearsal."""
from apps.cms.tests.support import grant_cms_role
import hashlib
import io
import base64
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.management import call_command
from django.db import IntegrityError, connection, transaction
from django.db import close_old_connections, connections
from django.db.migrations.executor import MigrationExecutor
from django.http import Http404
from rest_framework.test import APIClient

from apps.audit.models import AuditEvent
from apps.authorization.models import Role, UserRoleAssignment
from apps.cms.models import ContentRevision, Page
from apps.cms.services.pages import create_page
from apps.media.models import MediaAsset, MediaAssetReference
from apps.media.selectors import asset_for_site, assets_for_site, resolve_reference
from apps.media.services import register_asset, update_asset, attach_asset, detach_reference, asset_write, inspect_bytes
from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.sites.models import Module, Site
from apps.sites.services.modules import enable_module_for_site
from apps.sites.services.lifecycle import archive_site

pytestmark = pytest.mark.django_db(transaction=True)
PAYLOAD = b"%PDF-1.7\nSite-owned asset bytes"


class StoredObject:
    @contextmanager
    def open(self, bucket, key):
        yield io.BytesIO(PAYLOAD)


@pytest.fixture
def media_world():
    call_command("seed_rbac", verbosity=0)
    kind, _ = OrganizationType.objects.get_or_create(code="UNIVERSITY", defaults={"name": "University"})
    owner = OrganizationUnit.objects.create(code="MEDIA-UOG", name="Media University", organization_type=kind)
    a = Site.objects.create(organization_unit=owner, code="MEDIA-A", name="Site A")
    b = Site.objects.create(organization_unit=owner, code="MEDIA-B", name="Site B")
    actor = get_user_model().objects.create_user(username="media-site-a")
    both = get_user_model().objects.create_user(username="media-both")
    for user, sites in ((actor, [a]), (both, [a, b])):
        for site in sites:
            UserRoleAssignment.objects.create(user=user, role=Role.objects.get(code="site-administrator"), scope="SITE", site=site, organization=owner)
    with connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO sites_module_implementation(code) VALUES ('MEDIA'), ('PAGES'), ('VISUAL_BUILDER') "
            "ON CONFLICT DO NOTHING"
        )
    module, _ = Module.objects.get_or_create(code="MEDIA", defaults={"name": "Media", "description": "Site-owned assets", "status": "IMPLEMENTED"})
    pages, _ = Module.objects.get_or_create(code="PAGES", defaults={"name": "Pages", "description": "Pages", "status": "IMPLEMENTED", "is_enabled": True})
    builder, _ = Module.objects.get_or_create(
        code="VISUAL_BUILDER",
        defaults={
            "name": "Visual Page Builder",
            "description": "Visual Page composition",
            "status": "IMPLEMENTED",
            "is_enabled": True,
        },
    )
    pages.is_enabled = True
    pages.save()
    module.is_enabled = True
    module.save()
    builder.status = "IMPLEMENTED"
    builder.is_enabled = True
    builder.save(update_fields=["status", "is_enabled"])
    for site in (a, b):
        enable_module_for_site(site.pk, module.pk)
        enable_module_for_site(site.pk, Module.objects.get(code="PAGES").pk)
        enable_module_for_site(site.pk, builder.pk)
    return SimpleNamespace(a=a, b=b, actor=actor, both=both)


def _asset(world, site=None, key="asset.pdf"):
    site = site or world.a
    return register_asset(world.both, site.pk, storage_reference=f"platform-private:sites/{site.pk}/{key}", original_filename="untrusted.exe", storage=StoredObject())


def _ready(world, asset):
    return update_asset(world.both, asset.site_id, asset.pk, changes={"status": "READY"})


def test_image_detection_and_stream_limit_do_not_depend_on_filename(monkeypatch):
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ2cAAAAASUVORK5CYII=")
    info = inspect_bytes(io.BytesIO(png))
    assert (info["detected_mime"], info["width"], info["height"]) == ("image/png", 1, 1)
    assert info["byte_count"] == len(png) and info["checksum"] == hashlib.sha256(png).hexdigest()
    assert inspect_bytes(io.BytesIO(b"not an image"))["detected_mime"] == "application/octet-stream"
    monkeypatch.setattr("apps.media.services.MAX_OBJECT_BYTES", 2)
    with pytest.raises(ValidationError, match="limit"):
        inspect_bytes(io.BytesIO(b"123"))


def test_stored_bytes_define_metadata_and_duplicate_object_is_a_database_conflict(media_world):
    w = media_world
    row = _asset(w)
    assert row.detected_mime == "application/pdf"
    assert row.byte_count == len(PAYLOAD) and row.checksum == hashlib.sha256(PAYLOAD).hexdigest()
    assert row.original_filename == "untrusted.exe" and row.status == "PENDING"
    before = AuditEvent.objects.filter(entity_type="media.mediaasset").count()
    with pytest.raises(IntegrityError) as error:
        _asset(w)
    assert error.value.__cause__.sqlstate == "23505"
    assert MediaAsset.objects.count() == 1
    assert AuditEvent.objects.filter(entity_type="media.mediaasset").count() == before
    assert connection.introspection.get_constraints(connection.cursor(), "media_mediaasset")["media_site_status_idx"]["columns"] == ["site_id", "status", "created_at"]


def test_two_site_selectors_updates_and_reassignment_never_expose_foreign_metadata(media_world):
    w = media_world
    foreign = _asset(w, w.b)
    assert not assets_for_site(w.actor, w.a.pk).exists()
    for action in (
        lambda: asset_for_site(w.actor, w.a.pk, foreign.pk),
        lambda: update_asset(w.actor, w.a.pk, foreign.pk, changes={"alt_text": "Leak"}),
        lambda: update_asset(w.actor, w.a.pk, foreign.pk, changes={"site_id": w.a.pk}),
    ):
        with pytest.raises(Http404):
            action()
    with pytest.raises(PermissionDenied):
        asset_for_site(w.actor, w.b.pk, foreign.pk)
    with pytest.raises(ValidationError):
        update_asset(w.both, w.b.pk, foreign.pk, changes={"site_id": w.a.pk})
    foreign.refresh_from_db()
    assert foreign.site_id == w.b.pk and foreign.alt_text == ""
    assert AuditEvent.objects.filter(entity_type="media.mediaasset", entity_id=str(foreign.pk)).count() == 1


@pytest.mark.parametrize("field,value", [("site_id", 0), ("storage_reference", "changed"), ("checksum", "0" * 64), ("created_by_id", 0)])
def test_orm_bulk_and_raw_updates_cannot_reassign_identity(media_world, field, value):
    row = _asset(media_world)
    for raw in (False, True):
        with pytest.raises(IntegrityError), transaction.atomic():
            if raw:
                with connection.cursor() as cursor:
                    cursor.execute(f"UPDATE media_mediaasset SET {field}=%s WHERE id=%s", [value, row.pk])
            else:
                MediaAsset.objects.filter(pk=row.pk).update(**{field: value})
    row.refresh_from_db()
    assert row.storage_reference.endswith("/asset.pdf") and row.site_id == media_world.a.pk


def test_lifecycle_and_audit_are_actor_site_bound_and_atomic(media_world):
    w = media_world
    row = _asset(w)
    with pytest.raises(ValidationError):
        update_asset(w.actor, w.a.pk, row.pk, changes={"status": "ARCHIVED"})
    update_asset(w.actor, w.a.pk, row.pk, changes={"status": "READY", "alt_text": "University report"})
    event = AuditEvent.objects.filter(entity_type="media.mediaasset", entity_id=str(row.pk)).latest("timestamp")
    assert event.actor_id == str(w.actor.pk) and event.after["site_id"] == w.a.pk
    assert event.before["status"] == "PENDING" and event.after["status"] == "READY"
    assert event.after["updated_by_id"] == w.actor.pk
    update_asset(w.actor, w.a.pk, row.pk, changes={"status": "ARCHIVED"})
    update_asset(w.actor, w.a.pk, row.pk, changes={"status": "READY"})
    with pytest.raises(IntegrityError), transaction.atomic():
        MediaAsset.objects.filter(pk=row.pk).update(alt_text="unguarded")
    row.refresh_from_db()
    assert row.alt_text == "University report"


def test_http_catalog_is_site_scoped_rejects_ownership_and_module_bypasses(media_world, monkeypatch):
    w = media_world
    own, foreign = _asset(w), _asset(w, w.b)
    client = APIClient()
    client.force_authenticate(user=w.actor)
    root = f"/api/v1/sites/{w.a.pk}/assets/"
    assert [r["id"] for r in client.get(root).json()["results"]] == [str(own.pk)]
    assert client.get(root + str(foreign.pk) + "/").status_code == 404
    assert client.patch(root + str(foreign.pk) + "/", {"alt_text": "No"}, format="json").status_code == 404
    assert client.patch(root + str(own.pk) + "/", {"site": w.b.pk}, format="json").status_code == 400
    assert client.patch(root + str(own.pk) + "/", {"checksum": "0" * 64}, format="json").status_code == 400
    changed = client.patch(root + str(own.pk) + "/", {"alt_text": "Owned"}, format="json")
    assert changed.status_code == 200 and changed.json()["alt_text"] == "Owned"
    assert client.get(f"/api/v1/sites/{w.b.pk}/assets/").status_code == 403
    monkeypatch.setattr("apps.media.storage.ObjectStorage", StoredObject)
    created = client.post(root, {"storage_reference": f"platform-private:sites/{w.a.pk}/second.pdf", "original_filename": "second.pdf"}, format="json")
    assert created.status_code == 405  # Object-path registration is no longer exposed over HTTP.
    Module.objects.filter(code="MEDIA").update(is_enabled=False)
    assert client.get(root).status_code == 403
    own.refresh_from_db()
    assert own.site_id == w.a.pk and own.alt_text == "Owned"


def test_rejected_status_is_terminal_and_archived_sites_are_frozen(media_world):
    w = media_world
    row = _asset(w)
    update_asset(w.actor, w.a.pk, row.pk, changes={"status": "REJECTED"})
    with pytest.raises(ValidationError):
        update_asset(w.actor, w.a.pk, row.pk, changes={"status": "READY"})
    with pytest.raises(IntegrityError):
        with asset_write(w.actor, w.a.pk, "content.media.upload"):
            MediaAsset.objects.filter(pk=row.pk).update(status="READY", updated_by=w.actor)
    archive_site(w.a.pk)
    with pytest.raises(ValidationError):
        update_asset(w.actor, w.a.pk, row.pk, changes={"alt_text": "No archived edit"})
    row.refresh_from_db()
    assert row.status == "REJECTED" and row.alt_text == ""


def test_http_placements_use_revision_ids_from_the_scoped_revision_api(media_world):
    w = media_world
    row = _ready(w, _asset(w))
    page = create_page(site=w.a, title="API Page", slug="api-page", actor=w.actor)
    grant_cms_role(site=w.a, user=w.actor, role="AUTHOR")
    client = APIClient()
    client.force_authenticate(user=w.actor)
    revisions = client.get(f"/api/v1/cms/sites/{w.a.pk}/content/{page.pk}/revisions/")
    assert revisions.status_code == 200
    revision_id = revisions.json()["results"][0]["id"]
    root = f"/api/v1/sites/{w.a.pk}/asset-references/"
    created = client.post(root, {"asset_id": str(row.pk), "page_revision_id": revision_id, "node_id": "slider-api", "field_path": "image"}, format="json")
    assert created.status_code == 201
    assert len(client.get(root).json()["results"]) == 1
    assert client.delete(root + created.json()["id"] + "/").status_code == 204
    assert client.get(root).json()["results"] == []
    assert MediaAsset.objects.get(pk=row.pk).site_id == w.a.pk


def test_concurrent_registration_commits_one_identity_and_one_audit(media_world):
    w = media_world
    barrier = Barrier(2)
    def run():
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            try:
                _asset(w)
                return "committed"
            except IntegrityError:
                return "conflict"
        finally:
            connections.close_all()
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(run), pool.submit(run)]
        assert sorted(f.result(timeout=30) for f in futures) == ["committed", "conflict"]
    assert MediaAsset.objects.count() == 1
    assert AuditEvent.objects.filter(entity_type="media.mediaasset").count() == 1


def test_audit_failure_rolls_back_metadata_and_preserves_asset(media_world):
    w = media_world
    row = _asset(w)
    # Exercise failure below Python: a rejected durable audit insert must abort
    # the same transaction that changed the metadata.
    with connection.cursor() as cursor:
        cursor.execute("CREATE FUNCTION media_test_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='media.mediaasset' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$")
        cursor.execute("CREATE TRIGGER media_test_audit_fail BEFORE INSERT ON audit_auditevent FOR EACH ROW EXECUTE FUNCTION media_test_audit_fail()")
    try:
        from django.db import DatabaseError
        with pytest.raises(DatabaseError):
            update_asset(w.actor, w.a.pk, row.pk, changes={"alt_text": "Must roll back"})
    finally:
        with connection.cursor() as cursor:
            cursor.execute("DROP TRIGGER media_test_audit_fail ON audit_auditevent")
            cursor.execute("DROP FUNCTION media_test_audit_fail()")
    row.refresh_from_db()
    assert row.alt_text == ""


def test_slider_gallery_and_repeater_placements_share_one_asset_and_detach_independently(media_world):
    w = media_world
    row = _ready(w, _asset(w))
    page = create_page(site=w.a, title="Media", slug="media", actor=w.actor)
    revision = ContentRevision.objects.get(content_id=page.pk, revision_number=page.revision_number)
    slider = attach_asset(w.actor, w.a.pk, asset_id=row.pk, page_revision_id=revision.pk, node_id="slider-1", field_path="slides.image", repeater_item_id="slide-1")
    gallery = attach_asset(w.actor, w.a.pk, asset_id=row.pk, page_revision_id=revision.pk, node_id="gallery-1", field_path="images.asset", repeater_item_id="image-1")
    second = attach_asset(w.actor, w.a.pk, asset_id=row.pk, page_revision_id=revision.pk, node_id="gallery-1", field_path="images.asset", repeater_item_id="image-2")
    with pytest.raises(IntegrityError):
        with asset_write(w.actor, w.a.pk, "content.media.upload"):
            MediaAssetReference.objects.create(site=w.a, asset=row, page_revision=revision, node_id="gallery-1", field_path="images.asset", repeater_item_id="image-1", created_by=w.actor)
    assert MediaAsset.objects.count() == 1 and MediaAssetReference.objects.count() == 3
    detach_reference(w.actor, w.a.pk, slider.pk)
    assert resolve_reference(w.actor, w.a.pk, gallery.pk).pk == row.pk
    assert resolve_reference(w.actor, w.a.pk, second.pk).pk == row.pk
    with pytest.raises(ValidationError):
        update_asset(w.actor, w.a.pk, row.pk, changes={"status": "ARCHIVED"})
    assert resolve_reference(w.actor, w.a.pk, gallery.pk).pk == row.pk
    detach_reference(w.actor, w.a.pk, gallery.pk)
    detach_reference(w.actor, w.a.pk, second.pk)
    update_asset(w.actor, w.a.pk, row.pk, changes={"status": "ARCHIVED"})
    update_asset(w.actor, w.a.pk, row.pk, changes={"status": "READY"})
    page.refresh_from_db()
    assert page.title == "Media" and page.blocks == []
    with pytest.raises(Http404):
        resolve_reference(w.actor, w.a.pk, slider.pk)
    with pytest.raises(Http404):
        resolve_reference(w.both, w.b.pk, gallery.pk)


def test_reference_database_rejects_foreign_page_and_asset(media_world):
    w = media_world
    row = _ready(w, _asset(w, w.b))
    page = create_page(site=w.a, title="Page", slug="page", actor=w.actor)
    revision = page.revisions.latest("revision_number")
    with pytest.raises(Http404):
        attach_asset(w.actor, w.a.pk, asset_id=row.pk, page_revision_id=revision.pk, node_id="x", field_path="image")
    with pytest.raises(IntegrityError):
        with asset_write(w.actor, w.a.pk, "content.media.upload"):
            MediaAssetReference.objects.create(site=w.a, asset=row, page_revision=revision, node_id="x", field_path="image", created_by=w.actor)
    assert not MediaAssetReference.objects.exists()
    own = _ready(w, _asset(w, w.a))
    foreign_page = create_page(site=w.b, title="Foreign Page", slug="foreign-page", actor=w.both)
    foreign_revision = foreign_page.revisions.latest("revision_number")
    with pytest.raises(Http404):
        attach_asset(w.actor, w.a.pk, asset_id=own.pk, page_revision_id=foreign_revision.pk, node_id="x", field_path="image")
    with pytest.raises(IntegrityError):
        with asset_write(w.actor, w.a.pk, "content.media.upload"):
            MediaAssetReference.objects.create(site=w.a, asset=own, page_revision=foreign_revision, node_id="x", field_path="image", created_by=w.actor)
    assert not MediaAssetReference.objects.exists()


def test_upgrade_from_pre_media_sprint_two_preserves_page_and_revision():
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    try:
        executor.migrate([("media", None)])
        assert "media_mediaasset" not in connection.introspection.table_names()
        # Use historical models at the actual baseline, not today's Site
        # model (whose homepage column does not exist before Media).
        historical=MigrationExecutor(connection).loader
        old_apps=historical.project_state(list(historical.applied_migrations)).apps
        OldType=old_apps.get_model("organizations","OrganizationType")
        OldOwner=old_apps.get_model("organizations","OrganizationUnit")
        OldSite=old_apps.get_model("sites","Site")
        OldPage=old_apps.get_model("cms","Page")
        OldRevision=old_apps.get_model("cms","ContentRevision")
        kind, _ = OldType.objects.get_or_create(code="UNIVERSITY",defaults={"name":"University"})
        owner=OldOwner.objects.create(code="UPGRADE",name="University",organization_type=kind)
        site=OldSite.objects.create(organization_unit=owner,code="UPGRADE",name="Legacy Site")
        legacy_image={"type":"image","ref":f"sites/{site.pk}/legacy.jpg","alt":"Legacy image"}
        from apps.cms.services.revisions import content_revision_write
        with content_revision_write(using="default"):
            page=OldPage.objects.create(revision_number=1,locale="en-us",site_id=site.pk,title="Sprint two page",slug="old-page",path="/old-page",blocks=[{"type":"paragraph","html":"<p>Retained</p>"},legacy_image])
            snapshot={"content_id":str(page.pk),"site_id":site.pk,"title":page.title,"slug":page.slug,"path":page.path,"blocks":page.blocks,"metadata":{},"status":"DRAFT"}
            import hashlib,json
            revision=OldRevision.objects.create(content_id=page.pk,site_id=site.pk,revision_number=1,status="DRAFT",snapshot=snapshot,changed_fields=["__created__"],content_hash=hashlib.sha256(json.dumps(snapshot,sort_keys=True).encode()).hexdigest())
        old_snapshot = revision.snapshot
    finally:
        MigrationExecutor(connection).migrate(latest)
    page=Page.objects.get(pk=page.pk)
    revision=ContentRevision.objects.get(pk=revision.pk)
    assert page.title == "Sprint two page" and page.blocks[0]["html"] == "<p>Retained</p>"
    assert page.blocks[1] == legacy_image
    assert revision.snapshot == old_snapshot
    assert not MediaAsset.objects.exists()


def test_revision_retention_detaches_media_before_history_delete(media_world, monkeypatch):
    w = media_world
    monkeypatch.setattr("apps.cms.services.revisions.MAX_RETAINED_DRAFT_REVISIONS", 2)
    row = _ready(w, _asset(w))
    page = create_page(site=w.a, title="Retain", slug="retain", actor=w.actor)
    first = page.revisions.get(revision_number=1)
    keep = attach_asset(
        w.actor, w.a.pk, asset_id=row.pk, page_revision_id=first.pk,
        node_id="gallery-1", field_path="images.asset", repeater_item_id="image-1",
    )
    for version in range(2, 5):
        page.title = f"Retain {version}"
        page.updated_by = w.actor
        page.save()
    assert not MediaAssetReference.objects.filter(pk=keep.pk).exists()
    assert MediaAsset.objects.filter(pk=row.pk).exists()
    assert page.revisions.count() == 2
    latest = page.revisions.latest("revision_number")
    remaining = attach_asset(
        w.actor, w.a.pk, asset_id=row.pk, page_revision_id=latest.pk,
        node_id="slider-1", field_path="slides.image", repeater_item_id="slide-1",
    )
    assert resolve_reference(w.actor, w.a.pk, remaining.pk).pk == row.pk


def test_page_delete_detaches_media_references_and_keeps_asset(media_world):
    w = media_world
    row = _ready(w, _asset(w))
    page = create_page(site=w.a, title="Delete me", slug="delete-me", actor=w.actor)
    revision = page.revisions.latest("revision_number")
    attach_asset(
        w.actor, w.a.pk, asset_id=row.pk, page_revision_id=revision.pk,
        node_id="gallery-1", field_path="images.asset",
    )
    assert MediaAssetReference.objects.filter(asset_id=row.pk).count() == 1
    page.delete()
    assert not MediaAssetReference.objects.filter(asset_id=row.pk).exists()
    assert MediaAsset.objects.get(pk=row.pk).site_id == w.a.pk
