"""Site-scoped Post authoring and taxonomy administration contracts."""
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model

from apps.api.models import Category, Post, Tag
from apps.cms.models import ContentRole, ContentStatus, SiteContentRoleAssignment
from apps.sites.models import Module
from apps.sites.services.modules import disable_module_for_site, enable_module_for_site

pytestmark = pytest.mark.django_db

POSTS = "/api/v1/sites/{site}/posts/"
CATEGORIES = "/api/v1/sites/{site}/categories/"
TAGS = "/api/v1/sites/{site}/tags/"


def _enable_posts_module(*sites):
    module = Module.objects.get(code="POSTS")
    if not module.is_enabled:
        module.is_enabled = True
        module.save(update_fields=("is_enabled",))
    for site in sites:
        enable_module_for_site(site.pk, module.pk)


def _viewer(oidc, username, roles=("platform-viewer",)):
    """A token whose Keycloak roles never grant CMS authoring."""
    return oidc.header(
        sub=str(uuid4()),
        preferred_username=username,
        email=f"{username}@uog.et",
        realm_access={"roles": list(roles)},
    )


@pytest.fixture
def author(sites):
    user = get_user_model().objects.create_user(username="posts-author")
    SiteContentRoleAssignment.objects.create(
        site=sites[0], user=user, role=ContentRole.AUTHOR,
    )
    return user


@pytest.fixture
def site_editor(client, oidc, author, sites):
    """Authenticated CMS author scoped to the first Site."""
    client.defaults.update(_viewer(oidc, author.username))
    assert client.get("/api/me/").status_code == 200
    return client


def test_posts_crud_filtering_search_ordering_and_pagination(site_editor, sites, author):
    site, other = sites
    _enable_posts_module(site, other)
    categories = Category.objects.create(site=site, code="NEWS", name="News")
    tags = Tag.objects.create(site=site, code="CAMPUS", name="Campus")
    url = POSTS.format(site=site.pk)

    created = site_editor.post(
        url,
        {
            "title": "Opening ceremony",
            "slug": "opening-ceremony",
            "content": "The new campus opened.",
            "excerpt": "Campus news",
            "categories": [str(categories.pk)],
            "tags": [str(tags.pk)],
            "seo": {"meta_title": "Opening", "meta_description": "Details"},
        },
        content_type="application/json",
    )
    assert created.status_code == 201, created.content
    body = created.json()
    post_id = body["id"]
    assert body["status"] == ContentStatus.DRAFT
    assert body["site"] == site.pk
    assert body["categories"] == [str(categories.pk)]
    assert body["tags"] == [str(tags.pk)]
    assert created["ETag"].startswith('"cms-content-')
    assert created["Cache-Control"] == "private, no-store"
    assert created["Location"].endswith(f"/posts/{post_id}/")

    detail_url = created["Location"]
    detail = site_editor.get(detail_url)
    assert detail.status_code == 200 and detail.json()["slug"] == "opening-ceremony"

    # Filters, search, ordering and pagination all scope to this Site.
    Post.objects.create(site=site, title="Second story", slug="second-story", content="Body")
    Post.objects.create(site=other, title="Foreign story", slug="foreign-story", content="Body")
    assert site_editor.get(url).json()["count"] == 2
    assert site_editor.get(url + "?status=DRAFT").json()["count"] == 2
    assert site_editor.get(url + f"?category={categories.pk}").json()["count"] == 1
    assert site_editor.get(url + f"?tag={tags.pk}").json()["count"] == 1
    assert site_editor.get(url + f"?author={author.pk}").json()["count"] == 1
    assert site_editor.get(url + "?created_after=2020-01-01T00:00:00Z").json()["count"] == 2
    assert site_editor.get(url + "?created_before=2020-01-01T00:00:00Z").json()["count"] == 0
    assert site_editor.get(url + "?published_after=2020-01-01T00:00:00Z").json()["count"] == 0
    assert site_editor.get(url + "?created_after=not-a-date").status_code == 400
    assert site_editor.get(url + "?search=opening").json()["count"] == 1
    assert site_editor.get(url + "?ordering=title").json()["results"][0]["slug"] == "opening-ceremony"
    page = site_editor.get(url + "?page_size=1&page=2").json()
    assert page["count"] == 2 and page["next"] is None and len(page["results"]) == 1

    # Unknown and repeated parameters are rejected instead of ignored.
    assert site_editor.get(url + "?unexpected=1").status_code == 400
    assert site_editor.get(url + "?ordering=title&ordering=-title").status_code == 400

    updated = site_editor.patch(
        detail_url,
        {"title": "Opening ceremony (updated)"},
        content_type="application/json",
        HTTP_IF_MATCH=detail["ETag"],
    )
    assert updated.status_code == 200, updated.content
    assert updated.json()["title"] == "Opening ceremony (updated)"
    assert updated.json()["revision_number"] == detail.json()["revision_number"] + 1

    stale = site_editor.patch(
        detail_url,
        {"title": "Stale write"},
        content_type="application/json",
        HTTP_IF_MATCH=detail["ETag"],
    )
    assert stale.status_code == 409

    removed = site_editor.delete(detail_url)
    assert removed.status_code == 204
    assert not Post.objects.filter(pk=post_id).exists()


def test_duplicate_slug_and_cross_site_taxonomy_return_actionable_errors(site_editor, sites):
    site, other = sites
    _enable_posts_module(site, other)
    Category.objects.create(site=site, code="NEWS", name="News")
    foreign = Category.objects.create(site=other, code="NEWS", name="News")
    url = POSTS.format(site=site.pk)
    assert site_editor.post(
        url, {"title": "First", "slug": "same-slug", "content": "Body"},
        content_type="application/json",
    ).status_code == 201

    duplicate = site_editor.post(
        url, {"title": "Second", "slug": "same-slug", "content": "Body"},
        content_type="application/json",
    )
    assert duplicate.status_code == 400
    assert "slug" in duplicate.json()["error"]["details"]

    foreign_taxonomy = site_editor.post(
        url,
        {"title": "Third", "slug": "third", "content": "Body", "categories": [str(foreign.pk)]},
        content_type="application/json",
    )
    assert foreign_taxonomy.status_code == 400
    assert "another Site" in str(foreign_taxonomy.json()["error"]["details"])

    # Another Site's records are invisible through this Site's routes.
    hidden = Post.objects.create(site=other, title="Elsewhere", slug="elsewhere", content="Body")
    assert site_editor.get(url + f"{hidden.pk}/").status_code == 404


def test_taxonomy_crud_is_site_scoped_with_slug_normalization(site_editor, sites):
    site, other = sites
    _enable_posts_module(site, other)
    url = CATEGORIES.format(site=site.pk)

    created = site_editor.post(
        url, {"code": "CAMPUS_LIFE", "name": "Campus Life"},
        content_type="application/json",
    )
    assert created.status_code == 201, created.content
    assert created.json()["slug"] == "campus-life"
    detail_url = created["Location"]

    fetch = site_editor.get(detail_url)
    assert fetch.status_code == 200 and fetch.json()["is_active"] is True
    assert site_editor.get(url + "?is_active=false").json()["count"] == 0
    assert site_editor.get(url + "?search=campus").json()["count"] == 1

    patched = site_editor.patch(
        detail_url, {"name": "Campus News"},
        content_type="application/json", HTTP_IF_MATCH=fetch["ETag"],
    )
    assert patched.status_code == 200, patched.content
    # Published routes stay stable: renaming does not silently move the slug.
    assert patched.json()["slug"] == "campus-life"

    duplicate = site_editor.post(
        url, {"code": "OTHER", "name": "Campus Life copy", "slug": "campus-life"},
        content_type="application/json",
    )
    assert duplicate.status_code == 400
    assert "slug" in duplicate.json()["error"]["details"]

    tag_url = TAGS.format(site=site.pk)
    tag = site_editor.post(
        tag_url, {"code": "AWARDS", "name": "Awards"}, content_type="application/json",
    )
    assert tag.status_code == 201, tag.content
    assert site_editor.get(tag_url).json()["count"] == 1
    tag_detail = site_editor.get(tag["Location"])
    tag_update = site_editor.patch(
        tag["Location"], {"name": "Awards and Prizes"},
        content_type="application/json", HTTP_IF_MATCH=tag_detail["ETag"],
    )
    assert tag_update.status_code == 200, tag_update.content
    assert tag_update.json()["name"] == "Awards and Prizes"
    duplicate_tag = site_editor.post(
        tag_url, {"code": "AWARDS_COPY", "name": "Awards copy", "slug": "awards"},
        content_type="application/json",
    )
    assert duplicate_tag.status_code == 400
    assert "slug" in duplicate_tag.json()["error"]["details"]
    assert site_editor.delete(tag["Location"]).status_code == 204
    assert not Tag.objects.filter(pk=tag.json()["id"]).exists()
    # Roles are Site-scoped: the author cannot administer another Site.
    assert site_editor.get(TAGS.format(site=other.pk)).status_code == 403

    # Deleting a term clears its Post links instead of deleting the Posts.
    post = Post.objects.create(site=site, title="Referenced", slug="referenced", content="Body")
    post.categories.add(Category.objects.get(pk=created.json()["id"]))
    assert site_editor.delete(detail_url).status_code == 204
    assert not Category.objects.filter(pk=created.json()["id"]).exists()
    assert Post.objects.filter(pk=post.pk).exists() and post.categories.count() == 0


def test_authoring_requires_a_site_cms_role_and_an_enabled_posts_module(
    site_editor, oidc, sites,
):
    site, _other = sites
    _enable_posts_module(site)
    outsider = get_user_model().objects.create_user(username="posts-outsider")
    outsider_header = _viewer(oidc, outsider.username)
    foreign_to_user = Post.objects.create(
        site=site, title="Private to editors", slug="private-to-editors", content="Body",
    )
    term = Category.objects.create(site=site, code="PRIVATE", name="Private")
    denied = site_editor.post(
        POSTS.format(site=site.pk),
        {"title": "Denied", "slug": "denied", "content": "Body"},
        content_type="application/json",
        **outsider_header,
    )
    assert denied.status_code == 403
    assert site_editor.get(
        CATEGORIES.format(site=site.pk), **outsider_header,
    ).status_code == 403
    assert site_editor.get(
        POSTS.format(site=site.pk) + f"{foreign_to_user.pk}/", **outsider_header,
    ).status_code == 403
    assert site_editor.get(
        CATEGORIES.format(site=site.pk) + f"{term.pk}/", **outsider_header,
    ).status_code == 403

    # Disabling POSTS blocks Post *and* taxonomy administration.
    disable_module_for_site(site.pk, Module.objects.get(code="POSTS").pk)
    blocked = site_editor.post(
        POSTS.format(site=site.pk),
        {"title": "Blocked", "slug": "blocked", "content": "Body"},
        content_type="application/json",
    )
    assert blocked.status_code == 400
    assert "POSTS module" in str(blocked.json()["error"]["details"])
    assert site_editor.get(TAGS.format(site=site.pk)).status_code == 400
    assert site_editor.get(POSTS.format(site=site.pk)).status_code == 400
    assert site_editor.post(
        CATEGORIES.format(site=site.pk),
        {"code": "BLOCKED", "name": "Blocked"},
        content_type="application/json",
    ).status_code == 400
    existing_category = Category.objects.create(site=site, code="EXISTING", name="Existing")
    category_url = CATEGORIES.format(site=site.pk) + f"{existing_category.pk}/"
    assert site_editor.patch(
        category_url, {"name": "Changed"}, content_type="application/json",
        HTTP_IF_MATCH=f'"cms-content-{existing_category.pk}-r{existing_category.revision_number}"',
    ).status_code == 400


def test_patch_requires_the_current_etag(site_editor, sites):
    site, _other = sites
    _enable_posts_module(site)
    post = Post.objects.create(site=site, title="Guarded", slug="guarded", content="Body")
    url = POSTS.format(site=site.pk) + f"{post.pk}/"
    assert site_editor.patch(
        url, {"title": "No precondition"}, content_type="application/json",
    ).status_code == 428
    assert site_editor.patch(
        url, {"title": "Forged"}, content_type="application/json",
        HTTP_IF_MATCH='"cms-content-0000-r0"',
    ).status_code == 409
