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


def test_featured_media_rejects_unregistered_paths_and_preserves_legacy_reads(site_editor, sites):
    site, other = sites
    _enable_posts_module(site, other)
    url = POSTS.format(site=site.pk)

    own = site_editor.post(
        url,
        {"title": "Own media", "slug": "own-media", "content": "Body",
         "blocks": [{"type": "paragraph", "html": '<p onclick="alert(1)">Safe<script>alert(2)</script></p>'}]},
        content_type="application/json",
    )
    assert own.status_code == 201, own.content
    assert own.json()["featured_media"] == ""
    assert "<script" not in own.json()["blocks"][0]["html"]
    assert "onclick" not in own.json()["blocks"][0]["html"]

    shared = site_editor.post(
        url,
        {"title": "Shared media", "slug": "shared-media", "content": "Body",
         "featured_media": "shared/brand/logo.png"},
        content_type="application/json",
    )
    assert shared.status_code == 400, shared.content
    assert "featured_media" in shared.json()["error"]["details"]

    foreign_seo_image = site_editor.post(
        url,
        {"title": "Foreign SEO image", "slug": "foreign-seo-image", "content": "Body",
         "seo": {"og_image_ref": f"sites/{other.pk}/og.jpg"}},
        content_type="application/json",
    )
    assert foreign_seo_image.status_code == 400
    assert "seo" in foreign_seo_image.json()["error"]["details"]

    for index, ref in enumerate((f"sites/{other.pk}/secret.jpg", "https://cdn.example/hero.jpg", "sites/../secret.jpg")):
        rejected = site_editor.post(
            url,
            {"title": "Rejected media", "slug": f"rejected-media-{index}", "content": "Body",
             "featured_media": ref},
            content_type="application/json",
        )
        assert rejected.status_code == 400
        assert "featured_media" in rejected.json()["error"]["details"]


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

ARTICLE={"schema_version":1,"html":'<h2>Campus news</h2><p>A <strong>bold</strong> and <em>emphasized</em> report.</p><h3>Details</h3><h4>More</h4><ul><li>One</li></ul><ol><li>Two</li></ol><blockquote>A quote</blockquote><p><a href="https://uog.edu.et/news">Read more</a></p>'}


def test_versioned_article_round_trip_revisions_and_conflict(site_editor, sites):
    from apps.cms.models import ContentRevision
    site=sites[0]
    _enable_posts_module(site)
    created=site_editor.post(POSTS.format(site=site.pk), {"title":"Formatted","slug":"formatted","editor_document":ARTICLE},content_type="application/json")
    assert created.status_code==201, created.content
    body=created.json()
    assert body["editor_document"]["schema_version"]==1
    assert "<h2>Campus news</h2>" in body["content"]
    assert body["blocks"]==[]
    detail=site_editor.get(created["Location"])
    assert detail.json()["editor_document"]==body["editor_document"]
    updated=site_editor.patch(created["Location"],{"editor_document":{"schema_version":1,"html":"<p>New report</p>"}},content_type="application/json",HTTP_IF_MATCH=created["ETag"])
    assert updated.status_code==200,updated.content
    assert ContentRevision.objects.filter(content_id=body["id"],snapshot__metadata__post_editor=body["editor_document"]).exists()
    stale=site_editor.patch(created["Location"],{"editor_document":ARTICLE},content_type="application/json",HTTP_IF_MATCH=created["ETag"])
    assert stale.status_code==409
    assert site_editor.get(created["Location"]).json()["editor_document"]["html"]=="<p>New report</p>"
    from apps.cms.services.revisions import restore_content_revision
    recovered,_=restore_content_revision(body["id"],body["revision_number"],actor=Post.objects.get(pk=body["id"]).created_by,expected_revision=updated.json()["revision_number"])
    assert recovered.metadata["post_editor"]==body["editor_document"]
    assert recovered.revision_number>updated.json()["revision_number"]


@pytest.mark.parametrize("document", [{"schema_version":1,"html":"\ud800"},{"schema_version":2,"html":"<p>Bad</p>"},{"schema_version":True,"html":"<p>Bad</p>"},{"schema_version":1,"html":""},{"schema_version":1,"html":"<p>"+"x"*200001+"</p>"},{"schema_version":1,"html":"<blockquote>"*17+"Deep"+"</blockquote>"*17},{"schema_version":1,"html":"<p>x</p>"*2001},{"schema_version":1,"html":"ok","extra":True},None])
def test_invalid_article_rejected_without_writes(site_editor,sites,document):
    _enable_posts_module(sites[0])
    before=Post.objects.count()
    response=site_editor.post(POSTS.format(site=sites[0].pk),{"title":"Invalid","slug":"invalid","editor_document":document},content_type="application/json")
    assert response.status_code==400,response.content
    assert "editor_document" in response.json()["error"]["details"]
    assert Post.objects.count()==before


def test_article_title_sanitization_and_legacy_compatibility(site_editor,sites):
    _enable_posts_module(sites[0])
    url=POSTS.format(site=sites[0].pk)
    missing=site_editor.post(url,{"slug":"missing","editor_document":ARTICLE},content_type="application/json")
    assert missing.status_code==400 and "title" in missing.json()["error"]["details"]
    unsafe={"schema_version":1,"html":'<h2 onclick="alert(1)">Safe</h2><script>alert(1)</script><p style="color:red"><a href="javascript:alert(2)">link</a><img src=x onerror=alert(3)>Text</p>'}
    created=site_editor.post(url,{"title":"Safe","slug":"safe","editor_document":unsafe},content_type="application/json")
    assert created.status_code==201,created.content
    html=created.json()["editor_document"]["html"]
    for forbidden in ["script","onclick","javascript:","onerror","style=","<img"]: assert forbidden not in html
    legacy=site_editor.patch(created["Location"],{"content":"Old client edit","blocks":[]},content_type="application/json",HTTP_IF_MATCH=created["ETag"])
    assert legacy.status_code==200,legacy.content
    assert legacy.json()["editor_document"] is None
    assert legacy.json()["content"]=="Old client edit"


def test_article_site_permission_and_module_gates(site_editor,oidc,sites):
    a,b=sites
    _enable_posts_module(a,b)
    foreign=Post.objects.create(site=b,title="Private foreign",slug="foreign-editor",content="Private")
    url=POSTS.format(site=a.pk)
    foreign_url=url+f"{foreign.pk}/"
    assert site_editor.get(foreign_url).status_code==404
    assert site_editor.patch(foreign_url,{"editor_document":ARTICLE},content_type="application/json",HTTP_IF_MATCH='"anything"').status_code==404
    assert site_editor.get(POSTS.format(site=b.pk)+f"{foreign.pk}/").status_code==403
    outsider=get_user_model().objects.create_user(username="article-outsider")
    assert site_editor.post(url,{"title":"Denied","slug":"denied-article","editor_document":ARTICLE},content_type="application/json",**_viewer(oidc,outsider.username)).status_code==403
    created=site_editor.post(url,{"title":"Local","slug":"local-article","editor_document":ARTICLE},content_type="application/json")
    assert created.status_code==201,created.content
    disable_module_for_site(a.pk,Module.objects.get(code="POSTS").pk)
    assert site_editor.post(url,{"title":"Disabled","slug":"disabled-article","editor_document":ARTICLE},content_type="application/json").status_code==400
    assert site_editor.patch(created["Location"],{"editor_document":ARTICLE},content_type="application/json",HTTP_IF_MATCH=created["ETag"]).status_code==400
    foreign.refresh_from_db()
    assert foreign.content=="Private"


def test_invalid_article_update_is_atomic_and_metadata_cannot_replace_body(site_editor,sites):
    from apps.cms.models import ContentRevision
    _enable_posts_module(sites[0])
    created=site_editor.post(POSTS.format(site=sites[0].pk),{"title":"Retain report","slug":"retain-report","editor_document":ARTICLE},content_type="application/json")
    assert created.status_code==201,created.content
    before=created.json()
    revisions=ContentRevision.objects.filter(content_id=before["id"]).count()
    for patch in [
        {"title":"Invalid change","editor_document":{"schema_version":7,"html":"<p>wrong</p>"}},
        {"editor_document":ARTICLE,"content":"Ambiguous"},
        {"metadata":{"post_editor":{"schema_version":1,"html":"<p>Bypass</p>"}}},
    ]:
        invalid=site_editor.patch(created["Location"],patch,content_type="application/json",HTTP_IF_MATCH=created["ETag"])
        assert invalid.status_code==400,invalid.content
        assert site_editor.get(created["Location"]).json()==before
        assert ContentRevision.objects.filter(content_id=before["id"]).count()==revisions
    metadata=site_editor.patch(created["Location"],{"metadata":{"audience":"University"}},content_type="application/json",HTTP_IF_MATCH=created["ETag"])
    assert metadata.status_code==200,metadata.content
    assert metadata.json()["editor_document"]==before["editor_document"]
    assert metadata.json()["content"]==before["content"]


def test_reserved_slug_and_inactive_taxonomy_are_rejected_without_overwrite(site_editor, sites):
    site, other = sites
    _enable_posts_module(site, other)
    url = POSTS.format(site=site.pk)
    active = Category.objects.create(site=site, code="NEWS", name="News")
    inactive = Category.objects.create(site=site, code="OLD", name="Old", is_active=False)
    created = site_editor.post(
        url,
        {"title": "Keep me", "slug": "keep-me", "content": "Original", "categories": [str(active.pk)]},
        content_type="application/json",
    )
    assert created.status_code == 201, created.content
    before = created.json()

    reserved = site_editor.post(
        url, {"title": "Reserved", "slug": "admin", "content": "Body"},
        content_type="application/json",
    )
    assert reserved.status_code == 400
    assert "slug" in reserved.json()["error"]["details"]

    inactive_assign = site_editor.patch(
        created["Location"],
        {"categories": [str(inactive.pk)]},
        content_type="application/json",
        HTTP_IF_MATCH=created["ETag"],
    )
    assert inactive_assign.status_code == 400
    assert "categories" in inactive_assign.json()["error"]["details"]
    assert site_editor.get(created["Location"]).json()["categories"] == before["categories"]
    assert site_editor.get(created["Location"]).json()["slug"] == "keep-me"

    # Equivalent slugs are allowed when Sites differ (public hostname namespace).
    twin = Post.objects.create(site=other, title="Shared slug", slug="keep-me", content="Other site body")
    assert twin.slug == "keep-me"
    assert Post.objects.filter(slug="keep-me").count() == 2


def test_published_post_metadata_stays_locked_until_workflow_unlock(site_editor, sites, author):
    from apps.cms.tests.support import transition_with_site_role

    site, _other = sites
    _enable_posts_module(site)
    category = Category.objects.create(site=site, code="NEWS", name="News")
    created = site_editor.post(
        POSTS.format(site=site.pk),
        {
            "title": "Live campus",
            "slug": "live-campus",
            "excerpt": "Published summary",
            "content": "Published body",
            "categories": [str(category.pk)],
        },
        content_type="application/json",
    )
    assert created.status_code == 201, created.content
    post = Post.objects.get(pk=created.json()["id"])
    for action in ("submit", "approve", "publish"):
        transition_with_site_role(post, action, author if action == "submit" else get_user_model().objects.create_user(username=f"{action}-actor"))
        post.refresh_from_db()
    assert post.status == ContentStatus.PUBLISHED
    etag = f'"cms-content-{post.pk}-r{post.revision_number}"'
    locked = site_editor.patch(
        created["Location"],
        {"title": "Changed live", "slug": "changed-live", "excerpt": "New summary"},
        content_type="application/json",
        HTTP_IF_MATCH=etag,
    )
    assert locked.status_code == 400, locked.content
    post.refresh_from_db()
    assert post.title == "Live campus"
    assert post.slug == "live-campus"
    assert post.excerpt == "Published summary"


@pytest.mark.parametrize("fields,field", [
    ({"title":" "},"title"),
    ({"title":"x"*256},"title"),
    ({"slug":"x"*129},"slug"),
    ({"slug":"bad/path"},"slug"),
    ({"slug":"preview"},"slug"),
])
def test_post_metadata_validation_is_atomic(site_editor,sites,fields,field):
    _enable_posts_module(sites[0])
    created=site_editor.post(POSTS.format(site=sites[0].pk),{"title":"Keep metadata","slug":"keep-metadata","content":"Body","excerpt":"Keep summary"},content_type="application/json")
    assert created.status_code==201,created.content
    response=site_editor.patch(created["Location"],{**fields,"excerpt":"Must not persist"},content_type="application/json",HTTP_IF_MATCH=created["ETag"])
    assert response.status_code==400,response.content
    assert field in response.json()["error"]["details"]
    assert site_editor.get(created["Location"]).json()==created.json()


@pytest.mark.parametrize("model,field",[(Category,"categories"),(Tag,"tags")])
def test_post_metadata_rejects_foreign_and_inactive_taxonomy(site_editor,sites,model,field):
    a,b=sites
    _enable_posts_module(a,b)
    foreign=model.objects.create(site=b,code="FOREIGN_META",name="Foreign metadata")
    inactive=model.objects.create(site=a,code="INACTIVE_META",name="Inactive metadata",is_active=False)
    created=site_editor.post(POSTS.format(site=a.pk),{"title":"Taxonomy boundary","slug":"taxonomy-boundary","content":"Body"},content_type="application/json")
    assert created.status_code==201,created.content
    for term in [foreign,inactive]:
        response=site_editor.patch(created["Location"],{field:[str(term.pk)],"title":"Must not persist"},content_type="application/json",HTTP_IF_MATCH=created["ETag"])
        assert response.status_code==400,response.content
        assert field in response.json()["error"]["details"]
        assert site_editor.get(created["Location"]).json()==created.json()


def test_taxonomy_only_save_advances_etag_and_complete_revision_can_be_restored(site_editor,sites,author):
    from apps.cms.models import ContentRevision
    from apps.cms.services.revisions import restore_content_revision
    site=sites[0]
    _enable_posts_module(site)
    first=Category.objects.create(site=site,code="REV_FIRST",name="First revision category")
    second=Category.objects.create(site=site,code="REV_SECOND",name="Second revision category")
    tag=Tag.objects.create(site=site,code="REV_TAG",name="Revision tag")
    created=site_editor.post(POSTS.format(site=site.pk),{"title":"Original identity","slug":"original-identity","excerpt":"Original summary","content":"Body","categories":[str(first.pk)],"tags":[str(tag.pk)]},content_type="application/json")
    assert created.status_code==201,created.content
    initial=created.json()
    revision=ContentRevision.objects.get(content_id=initial["id"],revision_number=initial["revision_number"])
    assert revision.snapshot["categories"]==[str(first.pk)]
    assert revision.snapshot["tags"]==[str(tag.pk)]
    changed=site_editor.patch(created["Location"],{"categories":[str(second.pk)]},content_type="application/json",HTTP_IF_MATCH=created["ETag"])
    assert changed.status_code==200,changed.content
    assert changed.json()["revision_number"]==initial["revision_number"]+1
    assert changed["ETag"]!=created["ETag"]
    latest=ContentRevision.objects.get(content_id=initial["id"],revision_number=changed.json()["revision_number"])
    assert latest.snapshot["categories"]==[str(second.pk)]
    stale=site_editor.patch(created["Location"],{"tags":[]},content_type="application/json",HTTP_IF_MATCH=created["ETag"])
    assert stale.status_code==409
    final=site_editor.patch(created["Location"],{"title":"New identity","slug":"new-identity","excerpt":"New summary","tags":[]},content_type="application/json",HTTP_IF_MATCH=changed["ETag"])
    assert final.status_code==200,final.content
    restored,_=restore_content_revision(initial["id"],initial["revision_number"],actor=author,expected_revision=final.json()["revision_number"])
    assert restored.title=="Original identity" and restored.slug=="original-identity"
    assert restored.excerpt=="Original summary"
    assert list(restored.categories.values_list("pk",flat=True))==[first.pk]
    assert list(restored.tags.values_list("pk",flat=True))==[tag.pk]


def test_failed_taxonomy_persistence_rolls_back_post_relations_and_revision(sites):
    from django.core.exceptions import ValidationError
    from apps.cms.models import ContentRevision
    a,b=sites
    original=Category.objects.create(site=a,code="ATOMIC_OLD",name="Original")
    replacement=Category.objects.create(site=a,code="ATOMIC_NEW",name="Replacement")
    foreign=Tag.objects.create(site=b,code="ATOMIC_FOREIGN",name="Foreign")
    post=Post(site=a,title="Atomic metadata",slug="atomic-metadata",content="Body")
    post.save(taxonomy={"categories":[original]})
    revision=post.revision_number
    history=ContentRevision.objects.filter(content_id=post.pk).count()
    post.title="Must roll back"
    with pytest.raises(ValidationError):
        post.save(taxonomy={"categories":[replacement],"tags":[foreign]})
    post.refresh_from_db()
    assert post.title=="Atomic metadata"
    assert post.revision_number==revision
    assert list(post.categories.values_list("pk",flat=True))==[original.pk]
    assert post.tags.count()==0
    assert ContentRevision.objects.filter(content_id=post.pk).count()==history


def test_main_and_child_sites_share_post_metadata_contract(site_editor,sites,author):
    from apps.sites.models import Site
    main=Site.objects.create(organization_unit=sites[0].organization_unit.parent,code="MAIN_NEWS",name="Main Site")
    SiteContentRoleAssignment.objects.create(site=main,user=author,role=ContentRole.AUTHOR)
    _enable_posts_module(main,sites[0])
    for site in [main,sites[0]]:
        category=Category.objects.create(site=site,code="COMMON_NEWS",name="University news")
        tag=Tag.objects.create(site=site,code="COMMON_CAMPUS",name="Campus")
        response=site_editor.post(POSTS.format(site=site.pk),{"title":"University news","slug":"university-news","excerpt":"News summary","content":"Body","categories":[str(category.pk)],"tags":[str(tag.pk)]},content_type="application/json")
        assert response.status_code==201,response.content
        detail=site_editor.get(response["Location"])
        assert detail.json()["site"]==site.pk
        assert detail.json()["categories"]==[str(category.pk)]
        assert detail.json()["tags"]==[str(tag.pk)]


def test_post_revision_api_uses_posts_gate_and_restores_metadata(site_editor,sites):
    site=sites[0]
    _enable_posts_module(site)
    created=site_editor.post(POSTS.format(site=site.pk),{"title":"Original revision API","slug":"original-revision-api","excerpt":"Original summary","content":"Body"},content_type="application/json")
    assert created.status_code==201,created.content
    first=created.json()
    updated=site_editor.patch(created["Location"],{"title":"Changed revision API","excerpt":"Changed summary"},content_type="application/json",HTTP_IF_MATCH=created["ETag"])
    assert updated.status_code==200,updated.content
    history=f'/api/v1/cms/sites/{site.pk}/content/{first["id"]}/revisions/'
    # PAGES has no assignment on this Site. Post history belongs to POSTS.
    response=site_editor.get(history)
    assert response.status_code==200,response.content
    restored=site_editor.post(history+f'{first["revision_number"]}/restore/',{},content_type="application/json",HTTP_IF_MATCH=response["ETag"])
    assert restored.status_code==200,restored.content
    assert site_editor.get(created["Location"]).json()["title"]==first["title"]
    repeated=site_editor.post(history+f'{first["revision_number"]}/restore/',{},content_type="application/json",HTTP_IF_MATCH=restored["ETag"])
    assert repeated.status_code==200,repeated.content
    assert repeated.json()["revision_number"]>restored.json()["revision_number"]
    disable_module_for_site(site.pk,Module.objects.get(code="POSTS").pk)
    assert site_editor.get(history).status_code==400
    denied=site_editor.post(history+f'{first["revision_number"]}/restore/',{},content_type="application/json",HTTP_IF_MATCH=repeated["ETag"])
    assert denied.status_code==400
