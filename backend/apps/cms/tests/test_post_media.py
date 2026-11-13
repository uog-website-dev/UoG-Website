"""Article media identity, ownership, lifecycle and publication contract."""
from uuid import uuid4

import pytest
from django.core.management import call_command
from django.core.exceptions import ValidationError

from apps.api.models import Post
from apps.authorization.models import Role, UserRoleAssignment
from apps.cms.models import ContentRevision
from apps.cms.services.revisions import restore_content_revision
from apps.media.models import MediaAsset, MediaAssetReference
from apps.media.services import asset_write, update_asset
from apps.media.removal import remove_asset
from apps.sites.models import Module
from apps.sites.services.modules import enable_module_for_site, disable_module_for_site
from apps.sites.api.access import Conflict
from .test_posts_api import author, site_editor, POSTS, _enable_posts_module
from .test_public_posts import _host, _publish

pytestmark = pytest.mark.django_db


@pytest.fixture
def article_media(site_editor, author, sites):
    call_command("seed_rbac", verbosity=0)
    _enable_posts_module(*sites)
    module = Module.objects.get(code="MEDIA")
    module.is_enabled = True
    module.save()
    for site in sites:
        enable_module_for_site(site.pk, module.pk)
        UserRoleAssignment.objects.create(
            user=author, role=Role.objects.get(code="site-administrator"),
            scope="SITE", site=site, organization=site.organization_unit,
        )
    images = []
    for site in sites:
        with asset_write(author, site.pk, "content.media.upload"):
            image = MediaAsset.objects.create(
                site=site, storage_reference=f"platform-private:sites/{site.pk}/{uuid4()}.png",
                original_filename="campus.png", detected_mime="image/png", byte_count=100,
                checksum="a" * 64, created_by=author, updated_by=author, alt_text="Campus trees",
            )
        update_asset(author, site.pk, image.pk, changes={"status":"READY"})
        image.refresh_from_db()
        images.append(image)
    return images


def payload(site, image):
    return {
        "title":"Media article", "slug":"media-article",
        "featured_media":f"sites/{site.pk}/assets/{image.pk}", "featured_alt":"University campus",
        "editor_document":{"schema_version":1,"html":f'<p>Research news</p><img data-asset-id="{image.pk}" data-node-id="{uuid4()}" alt="Campus trees">'},
    }


def test_article_media_round_trip_removal_restore_and_deletion_guard(site_editor, author, sites, article_media):
    site = sites[0]
    image = article_media[0]
    before = MediaAsset.objects.count()
    response = site_editor.post(POSTS.format(site=site.pk), payload(site,image), content_type="application/json")
    assert response.status_code == 201, response.content
    data = response.json()
    url = POSTS.format(site=site.pk) + data["id"] + "/"
    assert site_editor.get(url).json()["editor_document"] == data["editor_document"]
    assert data["featured_alt"] == "University campus"
    assert "src=" not in data["editor_document"]["html"]
    assert MediaAsset.objects.count() == before
    post = Post.objects.get(pk=data["id"])
    first = ContentRevision.objects.get(content=post,revision_number=post.revision_number)
    assert MediaAssetReference.objects.filter(page_revision=first,asset=image).count() == 2
    with pytest.raises(Conflict):
        remove_asset(author,site.pk,image.pk)
    removed = site_editor.patch(url,{"featured_media":"","featured_alt":"","editor_document":{"schema_version":1,"html":"<p>News</p>"}},content_type="application/json",HTTP_IF_MATCH=response["ETag"])
    assert removed.status_code == 200, removed.content
    image.refresh_from_db()
    assert image.status == "READY" and image.deleted_at is None
    # Retained revisions keep their assets recoverable under the existing policy.
    with pytest.raises(Conflict):
        remove_asset(author,site.pk,image.pk)
    restored, _revision = restore_content_revision(content_id=post.pk,revision_number=first.revision_number,actor=author,expected_revision=removed.json()["revision_number"])
    assert restored.featured_media.endswith(str(image.pk))


@pytest.mark.parametrize("kind",["foreign_featured","foreign_inline","pending","archived","processing","document","missing_alt","duplicate_node","storage_path"])
def test_invalid_media_is_atomic(site_editor, sites, article_media, author, kind):
    site = sites[0]
    image, foreign = article_media
    body = payload(site,image)
    if kind == "foreign_featured":
        body["featured_media"] = f"sites/{site.pk}/assets/{foreign.pk}"
    elif kind == "foreign_inline":
        body["editor_document"]["html"] = body["editor_document"]["html"].replace(str(image.pk),str(foreign.pk))
    elif kind == "pending":
        with asset_write(author,site.pk,"content.media.upload"):
            pending = MediaAsset.objects.create(site=site,storage_reference=f"platform-private:sites/{site.pk}/{uuid4()}.png",original_filename="pending.png",detected_mime="image/png",byte_count=100,checksum="c"*64,created_by=author,updated_by=author)
        body["featured_media"] = f"sites/{site.pk}/assets/{pending.pk}"
    elif kind == "processing":
        from apps.media.models import MediaProcessing
        with asset_write(author,site.pk,"content.media.upload"):
            MediaProcessing.objects.create(asset=image)
    elif kind == "archived":
        update_asset(author,site.pk,image.pk,changes={"status":"ARCHIVED"})
    elif kind == "document":
        with asset_write(author,site.pk,"content.media.upload"):
            document = MediaAsset.objects.create(site=site,storage_reference=f"platform-private:sites/{site.pk}/{uuid4()}.pdf",original_filename="news.pdf",detected_mime="application/pdf",byte_count=100,checksum="b"*64,created_by=author,updated_by=author)
        update_asset(author,site.pk,document.pk,changes={"status":"READY"})
        body["featured_media"] = f"sites/{site.pk}/assets/{document.pk}"
    elif kind == "missing_alt":
        body["featured_alt"] = ""
    elif kind == "duplicate_node":
        body["editor_document"]["html"] *= 2
    else:
        body["featured_media"] = f"sites/{site.pk}/private-object.png"
    before = (Post.objects.count(),ContentRevision.objects.count(),MediaAssetReference.objects.count())
    response = site_editor.post(POSTS.format(site=site.pk),body,content_type="application/json")
    assert response.status_code == 400, response.content
    assert (Post.objects.count(),ContentRevision.objects.count(),MediaAssetReference.objects.count()) == before


def test_media_permission_and_modules_gate_direct_attachment(site_editor, author, sites, article_media):
    site = sites[0]
    body = payload(site,article_media[0])
    UserRoleAssignment.objects.filter(user=author).delete()
    assert site_editor.post(POSTS.format(site=site.pk),body,content_type="application/json").status_code == 403
    UserRoleAssignment.objects.create(user=author,role=Role.objects.get(code="site-administrator"),scope="SITE",site=site,organization=site.organization_unit)
    disable_module_for_site(site.pk,Module.objects.get(code="MEDIA").pk)
    assert site_editor.post(POSTS.format(site=site.pk),body,content_type="application/json").status_code == 403
    disable_module_for_site(site.pk,Module.objects.get(code="POSTS").pk)
    assert site_editor.post(POSTS.format(site=site.pk),body,content_type="application/json").status_code == 400


def test_post_public_media_eligibility_and_foreign_host(client, site_editor, sites, article_media):
    from apps.media.delivery import is_published
    site, other = sites
    image = article_media[0]
    host, foreign_host = _host(site), _host(other)
    created = site_editor.post(POSTS.format(site=site.pk),payload(site,image),content_type="application/json")
    assert created.status_code == 201, created.content
    post = Post.objects.get(pk=created.json()["id"])
    assert not is_published(image)
    _publish(post)
    assert is_published(image)
    public = client.get("/api/v1/site-context/posts/media-article/",HTTP_HOST=host)
    assert public.status_code == 200, public.content
    assert public.json()["featured_alt"] == "University campus"
    assert "platform-private" not in public.content.decode()
    assert client.get(f"/api/v1/site-context/media/{image.pk}/",HTTP_HOST=foreign_host).status_code == 404
    disable_module_for_site(site.pk,Module.objects.get(code="POSTS").pk)
    assert not is_published(image)


def test_reference_endpoint_cannot_detach_retained_article_uses(site_editor, author, sites, article_media):
    from apps.media.services import detach_reference
    site = sites[0]
    response = site_editor.post(POSTS.format(site=site.pk),payload(site,article_media[0]),content_type="application/json")
    assert response.status_code == 201
    reference = MediaAssetReference.objects.filter(asset=article_media[0]).first()
    with pytest.raises(ValidationError,match="revision retention"):
        detach_reference(author,site.pk,reference.pk)
    assert MediaAssetReference.objects.filter(pk=reference.pk).exists()
    inventory = site_editor.get(f"/api/v1/sites/{site.pk}/assets/{article_media[0].pk}/references/")
    assert inventory.status_code == 200
    assert all(row["scope"] == "REVISION" and not row["detachable"] for row in inventory.json()["references"])


def test_stale_article_save_preserves_media_references(site_editor, sites, article_media):
    site = sites[0]
    response = site_editor.post(POSTS.format(site=site.pk),payload(site,article_media[0]),content_type="application/json")
    assert response.status_code == 201
    url = POSTS.format(site=site.pk) + response.json()["id"] + "/"
    first = site_editor.patch(url,{"featured_media":"","featured_alt":""},content_type="application/json",HTTP_IF_MATCH=response["ETag"])
    assert first.status_code == 200
    references = list(MediaAssetReference.objects.values_list("pk",flat=True))
    stale = site_editor.patch(url,{"featured_alt":"Stale text"},content_type="application/json",HTTP_IF_MATCH=response["ETag"])
    assert stale.status_code == 409
    assert list(MediaAssetReference.objects.values_list("pk",flat=True)) == references
    assert site_editor.get(url).json()["featured_media"] == ""


@pytest.mark.parametrize("published", [False, True])
def test_quarantined_images_have_safe_delivery_and_publication_failure(site_editor, client, author, sites, article_media, published):
    from django.contrib.auth import get_user_model
    from apps.cms.models import PublishedContentSnapshot
    from apps.cms.tests.support import transition_with_site_role
    from apps.media.processing import processing_write
    site = sites[0]
    image = article_media[0]
    host = _host(site)
    created = site_editor.post(POSTS.format(site=site.pk),payload(site,image),content_type="application/json")
    assert created.status_code == 201
    post = Post.objects.get(pk=created.json()["id"])
    reviewer = get_user_model().objects.create_user(username="media-reviewer")
    publisher = get_user_model().objects.create_user(username="media-publisher")
    transition_with_site_role(post,"submit",author)
    transition_with_site_role(post,"approve",reviewer)
    if published:
        transition_with_site_role(post,"publish",publisher)
    with processing_write(image):
        image.status = "REJECTED"
        image.save(update_fields=["status"])
    assert client.get(f"/api/v1/site-context/media/{image.pk}/",HTTP_HOST=host).status_code == 404
    snapshots = PublishedContentSnapshot.objects.filter(content=post).count()
    if published:
        result = transition_with_site_role(post,"unpublish",publisher)
        assert result.status == "UNPUBLISHED"
    else:
        with pytest.raises(ValidationError,match="ready image"):
            transition_with_site_role(post,"publish",publisher)
        post.refresh_from_db()
        assert post.status == "APPROVED"
    assert PublishedContentSnapshot.objects.filter(content=post).count() == snapshots
