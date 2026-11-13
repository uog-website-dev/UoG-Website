"""Post authoring, review and published public Site-context delivery."""
from apps.cms.tests.support import grant_cms_role
import pytest
from django.contrib.auth import get_user_model

from apps.api.models import Category, Post, Tag
from apps.audit.models import AuditEvent
from apps.cms.models import (
    ContentRole, ContentStatus, PublishedContentSnapshot,
)
from apps.cms.services.publication_cache import current_publication_version
from apps.cms.tests.support import transition_with_site_role
from apps.sites.models import SiteDomain
from apps.sites.services.lifecycle import activate_site
from apps.sites.services.modules import disable_module_for_site, enable_module_for_site


pytestmark = pytest.mark.django_db
PUBLIC_POSTS = "/api/v1/site-context/posts/"


def _host(site):
    activate_site(site.pk)
    SiteDomain.objects.create(
        site=site, hostname=f"posts-{site.pk}.uog.edu.et",
        is_primary=True, status=SiteDomain.Status.ACTIVE,
    )
    return f"posts-{site.pk}.uog.edu.et"


def _new_user(username):
    return get_user_model().objects.create_user(username=username)


def _publish(post):
    submitter = _new_user(f"submit-{post.site_id}-{post.slug}")
    reviewer = _new_user(f"review-{post.site_id}-{post.slug}")
    publisher = _new_user(f"publish-{post.site_id}-{post.slug}")
    for action, actor in (
        ("submit", submitter), ("approve", reviewer), ("publish", publisher),
    ):
        transition_with_site_role(post, action, actor)
    post.refresh_from_db()
    return post


def test_public_feed_detail_site_taxonomy_draft_and_host_isolation(
    client, sites, posts_module,
):
    site, other = sites
    host = _host(site)
    other_host = _host(other)
    category = Category.objects.create(site=site, code="NEWS", name="News")
    _publish(category)
    tag = Tag.objects.create(site=site, code="CAMPUS", name="Campus")
    foreign_category = Category.objects.create(site=other, code="PRIVATE_NEWS", name="Private News")
    foreign_tag = Tag.objects.create(site=other, code="PRIVATE_TAG", name="Private Tag")
    own = Post.objects.create(
        site=site, title="Campus Update", slug="shared-slug", excerpt="News",
        content="Own Site content", featured_media="/media/campus.jpg",
        seo={"meta_title": "Campus Update"},
    )
    own.categories.add(category)
    own.tags.add(tag)
    _publish(own)
    draft = Post.objects.create(site=site, title="Draft", slug="draft-post", content="Secret")
    foreign = Post.objects.create(
        site=other, title="Foreign Update", slug="shared-slug", content="Foreign secret",
    )
    foreign.categories.add(foreign_category)
    foreign.tags.add(foreign_tag)
    _publish(foreign)

    feed = client.get(PUBLIC_POSTS, HTTP_HOST=host)
    assert feed.status_code == 200, feed.content
    assert [item["slug"] for item in feed.json()["results"]] == ["shared-slug"]
    assert feed["Vary"] and "host" in feed["Vary"].lower()
    assert feed.json()["results"][0]["excerpt"] == "News"
    assert feed.json()["results"][0]["featured_media"] == "/media/campus.jpg"

    filtered = client.get(PUBLIC_POSTS + "?category=news&tag=campus", HTTP_HOST=host)
    assert [item["id"] for item in filtered.json()["results"]] == [str(own.pk)]
    assert client.get(PUBLIC_POSTS + f"?category={foreign_category.slug}", HTTP_HOST=host).json()["count"] == 0
    assert client.get(PUBLIC_POSTS + f"?tag={foreign_tag.slug}", HTTP_HOST=host).json()["count"] == 0
    detail = client.get(PUBLIC_POSTS + "shared-slug/", HTTP_HOST=host)
    assert detail.status_code == 200
    assert detail.json()["content"] == "Own Site content"
    assert detail.json()["seo"]["meta_title"] == "Campus Update"
    assert detail.json()["categories"][0]["slug"] == "news"
    assert client.get(PUBLIC_POSTS + f"{draft.slug}/", HTTP_HOST=host).status_code == 404
    assert client.get(PUBLIC_POSTS + "shared-slug/", HTTP_HOST=other_host).json()["content"] == "Foreign secret"
    assert client.get(PUBLIC_POSTS, HTTP_HOST=host, HTTP_X_FORWARDED_HOST=other_host).json()["results"][0]["id"] == str(own.pk)
    assert client.get(PUBLIC_POSTS, HTTP_HOST="unknown.uog.edu.et").status_code == 404


def test_editor_creates_reviews_and_publishes_post_to_public_feed(
    client, oidc, sites, posts_module,
):
    site, _other = sites
    host = _host(site)
    users = {
        role: _new_user(f"public-e2e-{role.lower()}")
        for role in (ContentRole.AUTHOR, ContentRole.REVIEWER, ContentRole.PUBLISHER)
    }
    for role, user in users.items():
        grant_cms_role(site=site, user=user, role=role)

    def auth(role):
        user = users[role]
        return oidc.header(
            sub=f"post-e2e-{role.lower()}", preferred_username=user.username,
            email=f"{user.username}@uog.et",
            realm_access={"roles": ["platform-viewer"]},
        )

    base = f"/api/v1/sites/{site.pk}"
    category = client.post(
        base + "/categories/", {"code": "RESEARCH", "name": "Research"},
        content_type="application/json", **auth(ContentRole.AUTHOR),
    )
    tag = client.post(
        base + "/tags/", {"code": "CAMPUS", "name": "Campus"},
        content_type="application/json", **auth(ContentRole.AUTHOR),
    )
    assert category.status_code == tag.status_code == 201
    created = client.post(
        base + "/posts/",
        {
            "title": "Research update", "slug": "research-update",
            "excerpt": "New research", "editor_document": {"schema_version":1,"html":"<h2>Research</h2><p><strong>Research body</strong></p>"},
            "excerpt_html": (
                '<p onclick="alert(1)">Safe <script>alert(2)</script>'
                '<a href="javascript:alert(3)">bad link</a></p>'
            ),
            "seo": {"meta_title": "Research update"},
            "categories": [category.json()["id"]], "tags": [tag.json()["id"]],
        }, content_type="application/json", **auth(ContentRole.AUTHOR),
    )
    assert created.status_code == 201, created.content
    post_id = created.json()["id"]
    assert created.json()["status"] == ContentStatus.DRAFT
    assert created.json()["available_actions"] == ["submit"]
    assert "<script" not in created.json()["excerpt_html"]
    assert "onclick" not in created.json()["excerpt_html"]
    assert "javascript:" not in created.json()["excerpt_html"]
    assert client.get(PUBLIC_POSTS, HTTP_HOST=host).json()["count"] == 0

    workflow = f"/api/v1/cms/sites/{site.pk}/content/{post_id}/workflow/"
    assert client.post(
        workflow, {"action": "submit"}, content_type="application/json",
        **auth(ContentRole.AUTHOR),
    ).status_code == 200
    assert client.post(
        workflow, {"action": "approve"}, content_type="application/json",
        **auth(ContentRole.AUTHOR),
    ).status_code == 403
    assert client.post(
        workflow, {"action": "approve"}, content_type="application/json",
        **auth(ContentRole.REVIEWER),
    ).status_code == 200
    assert client.post(
        workflow, {"action": "publish"}, content_type="application/json",
        **auth(ContentRole.PUBLISHER),
    ).status_code == 200

    feed = client.get(PUBLIC_POSTS + "?category=research&tag=campus", HTTP_HOST=host)
    assert feed.status_code == 200 and feed.json()["count"] == 1
    detail = client.get(PUBLIC_POSTS + "research-update/", HTTP_HOST=host)
    assert detail.status_code == 200
    assert detail.json()["editor_document"] == created.json()["editor_document"]
    assert detail.json()["content"] == "<h2>Research</h2><p><strong>Research body</strong></p>"
    assert "<script" not in detail.json()["excerpt_html"]
    assert PublishedContentSnapshot.objects.filter(content_id=post_id).count() == 1
    assert AuditEvent.objects.filter(entity_id=str(post_id), action="CONTENT_PUBLISHED").exists()


def test_post_publication_pagination_cache_and_disabled_module(
    client, sites, posts_module,
):
    site, other = sites
    host = _host(site)
    other_host = _host(other)
    posts = [_publish(Post.objects.create(
        site=site, title=f"Post {index}", slug=f"post-{index}", content="Body",
    )) for index in range(3)]
    expected = sorted(posts, key=lambda post: (post.published_at, str(post.pk)), reverse=True)
    one = client.get(PUBLIC_POSTS + "?page_size=2", HTTP_HOST=host)
    two = client.get(PUBLIC_POSTS + "?page=2&page_size=2", HTTP_HOST=host)
    assert [item["id"] for item in one.json()["results"]] == [str(p.pk) for p in expected[:2]]
    assert [item["id"] for item in two.json()["results"]] == [str(p.pk) for p in expected[2:]]
    assert one.json()["next"] is not None

    site_version = current_publication_version(site.pk, "en-us")
    other_version = current_publication_version(other.pk, "en-us")
    target = Post.objects.get(pk=posts[0].pk)
    transition_with_site_role(target, "unpublish", _new_user("public-unpublisher"))
    assert current_publication_version(site.pk, "en-us") == site_version + 1
    assert current_publication_version(other.pk, "en-us") == other_version

    disable_module_for_site(site.pk, posts_module.pk)
    assert client.get(PUBLIC_POSTS, HTTP_HOST=host).status_code == 404
    assert client.get(PUBLIC_POSTS + "post-1/", HTTP_HOST=host).status_code == 404
    assert client.get(PUBLIC_POSTS, HTTP_HOST=other_host).status_code == 200



def test_public_detail_includes_optional_author_byline_without_admin_fields(
    client, sites, posts_module,
):
    site = sites[0]
    host = _host(site)
    author = get_user_model().objects.create_user(
        username="campus-writer",
        first_name="Ada",
        last_name="Bekele",
    )
    post = Post.objects.create(
        site=site,
        title="Author byline article",
        slug="author-byline",
        content="<p>Public body</p>",
        author=author,
        featured_media="",
    )
    _publish(post)
    detail = client.get(PUBLIC_POSTS + "author-byline/", HTTP_HOST=host)
    assert detail.status_code == 200, detail.content
    body = detail.json()
    assert body["author"] == "Ada Bekele"
    assert body["featured_media"] == ""
    assert "author_id" not in body
    assert "status" not in body
    assert "available_actions" not in body


def test_published_article_document_remains_snapshot_bound(client,sites,posts_module):
    site=sites[0]
    host=_host(site)
    document={"schema_version":1,"html":"<h2>Approved report</h2><p><strong>Published text</strong></p>"}
    post=Post.objects.create(site=site,title="Formatted report",slug="formatted-public",content=document["html"],metadata={"post_editor":document})
    _publish(post)
    public=client.get(PUBLIC_POSTS+post.slug+"/",HTTP_HOST=host)
    assert public.status_code==200,public.content
    assert public.json()["editor_document"]==document
    post.metadata={"post_editor":{"schema_version":1,"html":"<p>Private revision</p>"}}
    from django.core.exceptions import ValidationError
    with pytest.raises(ValidationError, match="locked"):
        post.save()
    after=client.get(PUBLIC_POSTS+post.slug+"/",HTTP_HOST=host)
    assert after.json()["editor_document"]==document
    assert "Private revision" not in after.content.decode()


def test_draft_metadata_retains_previous_publication_until_workflow_republishes(client,sites,posts_module):
    site=sites[0]
    host=_host(site)
    category=_publish(Category.objects.create(site=site,code="META_NEWS",name="News"))
    tag=Tag.objects.create(site=site,code="META_CAMPUS",name="Campus")
    post=Post.objects.create(site=site,title="Published identity",slug="published-identity",excerpt="Published summary",content="Published body")
    post.categories.add(category)
    post.tags.add(tag)
    _publish(post)
    original=PublishedContentSnapshot.objects.get(content_id=post.pk)
    payload=original.payload
    public=client.get(PUBLIC_POSTS+post.slug+"/",HTTP_HOST=host)
    assert public.status_code==200
    assert public.json()["excerpt"]=="Published summary"
    assert public.json()["categories"][0]["name"]=="News"
    assert public.json()["tags"][0]["name"]=="Campus"
    for action in ("unpublish","restore"):
        transition_with_site_role(post,action,_new_user("metadata-"+action))
        post.refresh_from_db()
    post.title="Revised identity"
    post.slug="revised-identity"
    post.excerpt="Revised summary"
    post.save()
    revised_category=_publish(Category.objects.create(site=site,code="META_RESEARCH",name="Research"))
    revised_tag=Tag.objects.create(site=site,code="META_AWARDS",name="Awards")
    post.categories.set([revised_category])
    post.tags.set([revised_tag])
    original.refresh_from_db()
    assert original.payload==payload
    assert client.get(PUBLIC_POSTS+post.slug+"/",HTTP_HOST=host).status_code==404
    assert client.get(PUBLIC_POSTS+"published-identity/",HTTP_HOST=host).status_code==404
    assert client.get(PUBLIC_POSTS,HTTP_HOST=host).json()["count"]==0
    _publish(post)
    current=client.get(PUBLIC_POSTS+post.slug+"/",HTTP_HOST=host)
    assert current.status_code==200,current.content
    assert current.json()["title"]=="Revised identity"
    assert current.json()["excerpt"]=="Revised summary"
    assert current.json()["categories"][0]["name"]=="Research"
    assert current.json()["tags"][0]["name"]=="Awards"
    original.refresh_from_db()
    assert original.payload==payload
    assert PublishedContentSnapshot.objects.filter(content_id=post.pk).count()==2
