"""Published Pages stay public while a working draft is reviewed and published."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import close_old_connections, connections

from apps.api.models import Post
from apps.audit.models import AuditEvent
from apps.cms.models import (
    ContentRole,
    ContentStatus,
    Page,
    PublishedContentSnapshot,
    SiteContentRoleAssignment,
)
from apps.cms.services.pages import create_page
from apps.cms.services.publication_cache import (
    get_public_cache,
    public_cache_key,
)
from apps.cms.services import workflow as workflow_service
from apps.cms.services.workflow import transition_content
from apps.cms.services.working_drafts import open_working_draft
from apps.cms.tests.support import transition_with_site_role
from apps.sites.models import SiteDomain
from apps.sites.services.lifecycle import activate_site


pytestmark = pytest.mark.django_db

ADMIN_PAGES = "/api/v1/sites/{site_id}/pages/"
PUBLIC_PAGES = "/api/v1/site-context/pages/"


def _login(client, oidc, username, sub):
    client.defaults.update(oidc.header(
        sub=sub,
        preferred_username=username,
        email=f"{username}@uog.et",
        realm_access={"roles": ["platform-viewer"]},
    ))
    response = client.get("/api/me/")
    assert response.status_code == 200, response.content
    return get_user_model().objects.get(username=username)


def _grant(site, user, role):
    SiteContentRoleAssignment.objects.get_or_create(
        site=site, user=user, role=role,
    )


def _publish_host(site):
    activate_site(site.pk)
    SiteDomain.objects.create(
        site=site,
        hostname=f"site-{site.pk}.uog.edu.et",
        is_primary=True,
        status=SiteDomain.Status.ACTIVE,
    )
    return f"site-{site.pk}.uog.edu.et"


def _public(client, host, slug):
    return client.get(f"{PUBLIC_PAGES}{slug}/", HTTP_HOST=host)


def test_editor_reviews_a_draft_while_visitors_keep_the_published_page(
    client, oidc, pages_module, sites, django_capture_on_commit_callbacks,
):
    del pages_module
    site, other = sites
    host = _publish_host(site)
    author = _login(client, oidc, "t23-author", "11111111-1111-4111-8111-111111111111")
    reviewer = _login(client, oidc, "t23-reviewer", "22222222-2222-4222-8222-222222222222")
    publisher = _login(client, oidc, "t23-publisher", "33333333-3333-4333-8333-333333333333")
    outsider = _login(client, oidc, "t23-outsider", "44444444-4444-4444-8444-444444444444")
    _grant(site, author, ContentRole.AUTHOR)
    _grant(site, reviewer, ContentRole.REVIEWER)
    _grant(site, publisher, ContentRole.PUBLISHER)
    _grant(other, outsider, ContentRole.AUTHOR)

    _login(client, oidc, "t23-author", "11111111-1111-4111-8111-111111111111")
    created = client.post(
        ADMIN_PAGES.format(site_id=site.pk),
        {
            "title": "Admissions",
            "slug": "admissions",
            "blocks": [{"type": "paragraph", "html": "<p>Applications are open.</p>"}],
        },
        content_type="application/json",
    )
    assert created.status_code == 201, created.content
    page_id = created.json()["id"]
    page_url = f"{ADMIN_PAGES.format(site_id=site.pk)}{page_id}/"

    def act(user, action, target=page_url, comment=""):
        _login(client, oidc, user[0], user[1])
        return client.post(
            f"{target}workflow/",
            {"action": action, "comment": comment},
            content_type="application/json",
        )

    author_id = ("t23-author", "11111111-1111-4111-8111-111111111111")
    reviewer_id = ("t23-reviewer", "22222222-2222-4222-8222-222222222222")
    publisher_id = ("t23-publisher", "33333333-3333-4333-8333-333333333333")
    assert act(author_id, "submit").status_code == 200
    assert act(reviewer_id, "approve").status_code == 200
    published = act(publisher_id, "publish")
    assert published.status_code == 200, published.content
    live_etag = published["ETag"]

    before = _public(client, host, "admissions")
    assert before.status_code == 200
    assert before.json()["title"] == "Admissions"
    assert before.json()["id"] == page_id
    assert before.json()["publication_version"] == 1
    public_version = before["X-Publication-Version"]
    old_key = public_cache_key(
        site.pk, before.json()["locale"], "page:/admissions",
        version=int(public_version),
    )
    assert get_public_cache(site.pk, old_key) is not None

    _login(client, oidc, "t23-author", author_id[1])
    missing = client.post(f"{page_url}working-draft/", {}, content_type="application/json")
    assert missing.status_code == 428
    stale = client.post(
        f"{page_url}working-draft/", {},
        content_type="application/json",
        HTTP_IF_MATCH='"cms-content-stale-r1"',
    )
    assert stale.status_code == 409
    _login(client, oidc, "t23-outsider", "44444444-4444-4444-8444-444444444444")
    foreign = client.post(
        f"{page_url}working-draft/", {},
        content_type="application/json",
        HTTP_IF_MATCH=live_etag,
    )
    assert foreign.status_code == 403
    wrong_site = client.post(
        f"{ADMIN_PAGES.format(site_id=other.pk)}{page_id}/working-draft/",
        {},
        content_type="application/json",
        HTTP_IF_MATCH=live_etag,
    )
    assert wrong_site.status_code == 404

    _login(client, oidc, "t23-author", author_id[1])
    opened = client.post(
        f"{page_url}working-draft/", {},
        content_type="application/json",
        HTTP_IF_MATCH=live_etag,
    )
    assert opened.status_code == 201, opened.content
    draft = opened.json()
    assert draft["draft_of"] == page_id
    assert draft["status"] == "DRAFT"
    assert draft["slug"].startswith("wip-")
    assert draft["title"] == "Admissions"
    again = client.post(
        f"{page_url}working-draft/", {},
        content_type="application/json",
        HTTP_IF_MATCH=live_etag,
    )
    assert again.status_code == 200
    assert again.json()["id"] == draft["id"]

    locked = client.patch(
        page_url,
        {"title": "Changed in place"},
        content_type="application/json",
        HTTP_IF_MATCH=live_etag,
    )
    assert locked.status_code == 400
    edited = client.patch(
        f"{ADMIN_PAGES.format(site_id=site.pk)}{draft['id']}/",
        {
            "title": "Admissions revised",
            "slug": draft["slug"],
            "parent": None,
            "visibility": "PUBLIC",
            "metadata": {},
            "seo": {"meta_title": "Revised admissions"},
            "blocks": [{"type": "paragraph", "html": "<p>Revised applications.</p>"}],
        },
        content_type="application/json",
        HTTP_IF_MATCH=opened["ETag"],
    )
    assert edited.status_code == 200, edited.content
    during = _public(client, host, "admissions")
    assert during.json()["title"] == "Admissions"
    assert during.json()["seo"].get("meta_title") != "Revised admissions"
    assert during["X-Publication-Version"] == public_version
    assert _public(client, host, draft["slug"]).status_code == 404
    listed = client.get(PUBLIC_PAGES, HTTP_HOST=host)
    assert listed.status_code == 200
    assert [row["slug"] for row in listed.json()["results"]] == ["admissions"]
    assert listed.json()["results"][0]["title"] == "Admissions"

    draft_url = f"{ADMIN_PAGES.format(site_id=site.pk)}{draft['id']}/"
    assert act(author_id, "submit", draft_url).status_code == 200
    own_review = act(author_id, "approve", draft_url)
    assert own_review.status_code == 403
    assert act(reviewer_id, "approve", draft_url).status_code == 200
    with django_capture_on_commit_callbacks(execute=True):
        replaced = act(publisher_id, "publish", draft_url)
    assert replaced.status_code == 200, replaced.content
    assert replaced.json()["status"] == "ARCHIVED"

    after = _public(client, host, "admissions")
    assert after.status_code == 200
    assert after.json()["id"] == page_id
    assert after.json()["path"] == "/admissions"
    assert after.json()["title"] == "Admissions revised"
    assert after.json()["seo"]["meta_title"] == "Revised admissions"
    assert after.json()["publication_version"] == 2
    assert int(after["X-Publication-Version"]) == int(public_version) + 1
    assert get_public_cache(site.pk, old_key) is None
    live = Page.objects.get(pk=page_id)
    assert live.status == ContentStatus.PUBLISHED
    assert live.slug == "admissions"
    assert AuditEvent.objects.filter(
        entity_id=page_id, action="CONTENT_PUBLISHED",
    ).count() == 2
    retry = act(publisher_id, "publish", draft_url)
    assert retry.status_code == 409


def test_unpublish_archive_and_failed_publication_leave_the_public_snapshot(
    client, oidc, pages_module, sites, monkeypatch,
):
    del pages_module
    site, _other = sites
    host = _publish_host(site)
    author = _login(client, oidc, "t23-fail-author", "55555555-5555-4555-8555-555555555555")
    reviewer = _login(client, oidc, "t23-fail-reviewer", "66666666-6666-4666-8666-666666666666")
    publisher = _login(client, oidc, "t23-fail-publisher", "77777777-7777-4777-8777-777777777777")
    _grant(site, author, ContentRole.AUTHOR)
    _grant(site, reviewer, ContentRole.REVIEWER)
    _grant(site, publisher, ContentRole.PUBLISHER)
    page = create_page(
        site=site, title="Campus", slug="campus",
        blocks=[{"type": "paragraph", "html": "<p>Campus.</p>"}],
        actor=author,
    )
    transition_with_site_role(page, "submit", author)
    transition_with_site_role(page, "approve", reviewer)
    transition_with_site_role(page, "publish", publisher)
    draft, _created = open_working_draft(page, actor=author)
    draft.title = "Campus revised"
    draft.updated_by = author
    draft.save()
    transition_with_site_role(draft, "submit", author)
    transition_with_site_role(draft, "approve", reviewer)

    def fail_snapshot(*args, **kwargs):
        raise RuntimeError("snapshot failed")

    original_snapshot = workflow_service._create_publication_snapshot
    monkeypatch.setattr(workflow_service, "_create_publication_snapshot", fail_snapshot)
    with pytest.raises(RuntimeError, match="snapshot failed"):
        transition_content(draft.pk, action="publish", actor=publisher)
    monkeypatch.setattr(
        workflow_service, "_create_publication_snapshot", original_snapshot,
    )
    page.refresh_from_db()
    draft.refresh_from_db()
    assert page.title == "Campus"
    assert page.status == ContentStatus.PUBLISHED
    assert draft.status == ContentStatus.APPROVED
    assert PublishedContentSnapshot.objects.filter(content_id=page.pk).count() == 1
    assert _public(client, host, "campus").json()["title"] == "Campus"

    transition_with_site_role(page, "unpublish", publisher)
    assert _public(client, host, "campus").status_code == 404
    with pytest.raises(ValidationError):
        transition_content(draft.pk, action="publish", actor=publisher)
    page.refresh_from_db()
    draft.refresh_from_db()
    assert page.status == ContentStatus.UNPUBLISHED
    assert page.title == "Campus"
    assert draft.status == ContentStatus.APPROVED
    assert PublishedContentSnapshot.objects.filter(content_id=page.pk).count() == 1


def test_archiving_a_working_draft_keeps_the_published_page(sites):
    site, _other = sites
    author = get_user_model().objects.create_user(username="t23-archive-author")
    reviewer = get_user_model().objects.create_user(username="t23-archive-reviewer")
    publisher = get_user_model().objects.create_user(username="t23-archive-publisher")
    page = create_page(site=site, title="Library", slug="library", actor=author)
    transition_with_site_role(page, "submit", author)
    transition_with_site_role(page, "approve", reviewer)
    transition_with_site_role(page, "publish", publisher)
    draft, _created = open_working_draft(page, actor=author)
    draft.title = "Library revised"
    draft.save()
    transition_with_site_role(draft, "submit", author)
    transition_with_site_role(draft, "approve", reviewer)
    transition_with_site_role(draft, "archive", publisher)
    page.refresh_from_db()
    draft.refresh_from_db()
    assert draft.status == ContentStatus.ARCHIVED
    assert page.status == ContentStatus.PUBLISHED
    assert page.title == "Library"
    assert PublishedContentSnapshot.objects.get(content_id=page.pk).payload["title"] == "Library"


@pytest.mark.django_db(transaction=True)
def test_concurrent_working_draft_publication_applies_once(sites):
    site, _other = sites
    author = get_user_model().objects.create_user(username="t23-concurrent-author")
    reviewer = get_user_model().objects.create_user(username="t23-concurrent-reviewer")
    publisher = get_user_model().objects.create_user(username="t23-concurrent-publisher")
    for user, role in (
        (author, ContentRole.AUTHOR),
        (reviewer, ContentRole.REVIEWER),
        (publisher, ContentRole.PUBLISHER),
    ):
        SiteContentRoleAssignment.objects.create(site=site, user=user, role=role)
    page = create_page(site=site, title="Research", slug="research", actor=author)
    transition_content(page.pk, action="submit", actor=author)
    transition_content(page.pk, action="approve", actor=reviewer)
    transition_content(page.pk, action="publish", actor=publisher)
    draft, _created = open_working_draft(page, actor=author)
    draft.title = "Research revised"
    draft.save()
    transition_content(draft.pk, action="submit", actor=author)
    transition_content(draft.pk, action="approve", actor=reviewer)
    barrier = Barrier(2)

    def publish():
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            try:
                return transition_content(
                    draft.pk, action="publish", actor=publisher,
                ).status
            except ValidationError:
                return "rejected"
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _: publish(), range(2)))

    assert sorted(outcomes) == [ContentStatus.ARCHIVED, "rejected"]
    assert PublishedContentSnapshot.objects.filter(content_id=page.pk).count() == 2
    page.refresh_from_db()
    assert page.title == "Research revised"
    assert page.status == ContentStatus.PUBLISHED
    assert page.slug == "research"


def test_post_publication_does_not_use_page_working_drafts(sites, posts_module):
    del posts_module
    site, _other = sites
    author = get_user_model().objects.create_user(username="t23-post-author")
    reviewer = get_user_model().objects.create_user(username="t23-post-reviewer")
    publisher = get_user_model().objects.create_user(username="t23-post-publisher")
    post = Post.objects.create(
        site=site, title="Campus news", slug="campus-news",
        content="Body", created_by=author,
    )
    transition_with_site_role(post, "submit", author)
    transition_with_site_role(post, "approve", reviewer)
    published = transition_with_site_role(post, "publish", publisher)
    assert published.status == ContentStatus.PUBLISHED
    assert published.draft_of_id is None
    assert PublishedContentSnapshot.objects.filter(content_id=post.pk).count() == 1
    assert Page.objects.filter(draft_of__isnull=False).count() == 0
