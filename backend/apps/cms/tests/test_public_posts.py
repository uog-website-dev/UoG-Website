"""Public Post feeds are Site/Host scoped and read publication snapshots."""
import pytest
from django.contrib.auth import get_user_model

from apps.api.models import Category, Post, Tag
from apps.cms.models import ContentStatus, PublishedContentSnapshot
from apps.cms.services.publication_cache import current_publication_version
from apps.cms.services.workflow import transition_content
from apps.sites.models import SiteDomain
from apps.sites.services.lifecycle import activate_site


pytestmark = pytest.mark.django_db

POSTS = "/api/v1/site-context/posts/"


def _host(site):
    activate_site(site.pk)
    SiteDomain.objects.create(
        site=site, hostname=f"posts-{site.pk}.uog.edu.et",
        is_primary=True, status=SiteDomain.Status.ACTIVE,
    )
    return f"posts-{site.pk}.uog.edu.et"


def _post(site, slug, *, category=None, tag=None, published=True, **kwargs):
    post = Post.objects.create(
        site=site, title=kwargs.pop("title", slug.replace("-", " ").title()),
        slug=slug, excerpt=kwargs.pop("excerpt", f"Summary {slug}"),
        content=kwargs.pop("content", f"Body {slug}"),
        featured_media=kwargs.pop("featured_media", f"/media/{slug}.jpg"),
        seo=kwargs.pop("seo", {"meta_title": f"SEO {slug}"}), **kwargs,
    )
    if category:
        post.categories.add(category)
    if tag:
        post.tags.add(tag)
    if published:
        submitter = get_user_model().objects.create_user(username=f"submit-{site.pk}-{slug}")
        reviewer = get_user_model().objects.create_user(username=f"review-{site.pk}-{slug}")
        publisher = get_user_model().objects.create_user(username=f"publish-{site.pk}-{slug}")
        transition_content(post.pk, action="submit", actor=submitter, roles={"platform-admin"})
        transition_content(post.pk, action="approve", actor=reviewer, roles={"platform-admin"})
        transition_content(post.pk, action="publish", actor=publisher, roles={"platform-admin"})
        post.refresh_from_db()
    return post


def test_public_posts_host_scope_published_only_filters_and_detail(client, sites, posts_module):
    site, other = sites
    host = _host(site)
    other_host = _host(other)
    category = Category.objects.create(site=site, code="NEWS", name="News")
    tag = Tag.objects.create(site=site, code="CAMPUS", name="Campus")
    foreign_category = Category.objects.create(site=other, code="NEWS", name="News")
    foreign_tag = Tag.objects.create(site=other, code="CAMPUS", name="Campus")
    own = _post(site, "shared-slug", category=category, tag=tag)
    _post(site, "draft-post", published=False)
    _post(other, "shared-slug", category=foreign_category, tag=foreign_tag,
          content="Foreign secret")

    response = client.get(POSTS, HTTP_HOST=host)
    assert response.status_code == 200, response.content
    assert [row["slug"] for row in response.json()["results"]] == ["shared-slug"]
    assert "host" in response["Vary"].lower()
    assert response["X-Publication-Version"] == "1"

    filtered = client.get(POSTS + "?category=news&tag=campus", HTTP_HOST=host)
    assert filtered.status_code == 200
    assert [row["id"] for row in filtered.json()["results"]] == [str(own.pk)]
    assert filtered.json()["results"][0]["categories"][0]["slug"] == "news"
    assert filtered.json()["results"][0]["tags"][0]["slug"] == "campus"

    detail = client.get(POSTS + "shared-slug/", HTTP_HOST=host)
    assert detail.status_code == 200
    assert detail.json()["content"] == "Body shared-slug"
    assert detail.json()["featured_media"] == "/media/shared-slug.jpg"
    assert detail.json()["seo"]["meta_title"] == "SEO shared-slug"
    assert client.get(POSTS + "draft-post/", HTTP_HOST=host).status_code == 404
    assert client.get(POSTS + "shared-slug/", HTTP_HOST=other_host).json()["content"] == "Foreign secret"
    assert client.get(POSTS + "shared-slug/", HTTP_HOST="unknown.uog.edu.et").status_code == 404
    # Forwarded host is not trusted for tenant selection.
    assert client.get(POSTS, HTTP_HOST=host, HTTP_X_FORWARDED_HOST=other_host).json()["results"][0]["id"] == str(own.pk)


def test_public_posts_pagination_is_deterministic_and_module_gated(
    client, sites, posts_module,
):
    site, _other = sites
    host = _host(site)
    posts = [_post(site, f"post-{index}") for index in range(3)]
    ordered = sorted(posts, key=lambda post: (post.published_at, str(post.pk)), reverse=True)
    page_one = client.get(POSTS + "?page_size=2", HTTP_HOST=host)
    page_two = client.get(POSTS + "?page=2&page_size=2", HTTP_HOST=host)
    assert page_one.status_code == page_two.status_code == 200
    assert [row["id"] for row in page_one.json()["results"]] == [str(post.pk) for post in ordered[:2]]
    assert [row["id"] for row in page_two.json()["results"]] == [str(post.pk) for post in ordered[2:]]

    from apps.sites.services.modules import disable_module_for_site
    disable_module_for_site(site.pk, posts_module.pk)
    assert client.get(POSTS, HTTP_HOST=host).status_code == 404
    assert client.get(POSTS + f"{posts[0].slug}/", HTTP_HOST=host).status_code == 404


def test_public_post_cache_is_site_versioned_and_invalidated_on_unpublish(
    client, sites, posts_module,
):
    site, other = sites
    host = _host(site)
    _host(other)
    other_version = current_publication_version(other.pk, "en-us")
    before = current_publication_version(site.pk, "en-us")
    assert client.get(POSTS, HTTP_HOST=host).json()["count"] == 0
    post = _post(site, "cache-story", published=False)
    submitter = get_user_model().objects.create_user(username="cache-post-submitter")
    reviewer = get_user_model().objects.create_user(username="cache-post-reviewer")
    publisher = get_user_model().objects.create_user(username="cache-post-publisher")
    transition_content(post.pk, action="submit", actor=submitter, roles={"platform-admin"})
    transition_content(post.pk, action="approve", actor=reviewer, roles={"platform-admin"})
    transition_content(post.pk, action="publish", actor=publisher, roles={"platform-admin"})
    published = client.get(POSTS, HTTP_HOST=host)
    assert [row["slug"] for row in published.json()["results"]] == ["cache-story"]
    assert current_publication_version(site.pk, "en-us") == before + 1
    assert current_publication_version(other.pk, "en-us") == other_version
    assert PublishedContentSnapshot.objects.filter(content_id=post.pk).count() == 1

    transition_content(post.pk, action="unpublish", actor=publisher, roles={"platform-admin"})
    assert client.get(POSTS, HTTP_HOST=host).json()["count"] == 0
    assert current_publication_version(site.pk, "en-us") == before + 2
    assert current_publication_version(other.pk, "en-us") == other_version
    assert client.get(POSTS, HTTP_HOST=f"posts-{other.pk}.uog.edu.et").json()["count"] == 0
    assert Post.objects.get(pk=post.pk).status == ContentStatus.UNPUBLISHED
