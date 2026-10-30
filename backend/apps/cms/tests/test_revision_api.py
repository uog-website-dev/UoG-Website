"""HTTP authorization, Site isolation, ETags and restore behavior."""
import pytest
from django.contrib.auth import get_user_model

from apps.cms.models import ContentRole, Page
from apps.cms.services.pages import create_page

pytestmark = pytest.mark.django_db

BASE = "/api/v1/cms/sites/"


@pytest.fixture
def platform_admin(cms_platform_admin):
    return cms_platform_admin


def _url(site, content, suffix="revisions/"):
    return f"{BASE}{site.pk}/content/{content.pk}/{suffix}"


def _identity(oidc, subject, username, roles=("platform-viewer",)):
    return oidc.header(
        sub=subject,
        preferred_username=username,
        email=f"{username}@uog.et",
        realm_access={"roles": list(roles)},
    )


def test_revision_history_requires_site_role_and_is_site_scoped(
    client, oidc, platform_admin, sites,
):
    site, other_site = sites
    author = get_user_model().objects.get(username="devuser")
    page = create_page(
        site=site, title="Original", slug="original", actor=author,
    )
    outsider_token = _identity(
        oidc, "5f1b2c3d-0000-4000-8000-000000000022", "history-outsider",
    )
    denied = client.get(_url(site, page), **outsider_token)
    assert denied.status_code == 403

    assigned = platform_admin.post(
        f"{BASE}{site.pk}/content-roles/",
        {"user_id": author.pk, "role": ContentRole.AUTHOR},
        content_type="application/json",
    )
    assert assigned.status_code == 201
    author_token = oidc.header(realm_access={"roles": ["platform-viewer"]})
    history = client.get(_url(site, page), **author_token)
    assert history.status_code == 200
    assert history["ETag"] == f'"cms-content-{page.pk}-r1"'
    assert history.json()["count"] == 1
    assert history.json()["results"][0]["revision_number"] == 1
    assert history.json()["results"][0]["editor"] == str(author.pk)

    foreign_site = client.get(_url(other_site, page), **author_token)
    assert foreign_site.status_code == 404


def test_revision_detail_and_restore_are_authorized_conditional_and_safe(
    client, oidc, platform_admin, sites,
):
    site, _ = sites
    author = get_user_model().objects.get(username="devuser")
    page = create_page(
        site=site, title="Original", slug="original", actor=author,
    )
    page.title = "Newer title"
    page.updated_by = author
    page.save()
    platform_admin.post(
        f"{BASE}{site.pk}/content-roles/",
        {"user_id": author.pk, "role": ContentRole.AUTHOR},
        content_type="application/json",
    )
    author_token = oidc.header(realm_access={"roles": ["platform-viewer"]})

    detail = client.get(
        _url(site, page, "revisions/1/"), **author_token,
    )
    assert detail.status_code == 200
    assert detail.json()["snapshot"]["title"] == "Original"
    assert detail.json()["changed_fields"]

    missing_precondition = client.post(
        _url(site, page, "revisions/1/restore/"),
        {},
        content_type="application/json",
        **author_token,
    )
    assert missing_precondition.status_code == 428

    stale_etag = client.get(_url(site, page), **author_token)["ETag"]
    page.title = "Concurrent update"
    page.save()
    stale_restore = client.post(
        _url(site, page, "revisions/1/restore/"),
        {},
        content_type="application/json",
        HTTP_IF_MATCH=stale_etag,
        **author_token,
    )
    assert stale_restore.status_code == 409
    assert Page.objects.get(pk=page.pk).title == "Concurrent update"

    current_etag = client.get(_url(site, page), **author_token)["ETag"]
    restored = client.post(
        _url(site, page, "revisions/1/restore/"),
        {},
        content_type="application/json",
        HTTP_IF_MATCH=current_etag,
        **author_token,
    )
    assert restored.status_code == 200, restored.content
    page.refresh_from_db()
    assert page.title == "Original"
    assert page.status == "DRAFT"
    assert restored.json()["status"] == "DRAFT"
    assert restored.json()["restored_from_revision"] == 1
    assert restored["ETag"] == f'"cms-content-{page.pk}-r{page.revision_number}"'


def test_reviewer_can_inspect_but_cannot_restore_history(
    client, oidc, platform_admin, sites,
):
    site, _ = sites
    page = create_page(site=site, title="Review", slug="review")
    reviewer = get_user_model().objects.create_user(username="history-reviewer")
    assigned = platform_admin.post(
        f"{BASE}{site.pk}/content-roles/",
        {"user_id": reviewer.pk, "role": ContentRole.REVIEWER},
        content_type="application/json",
    )
    assert assigned.status_code == 201
    token = _identity(
        oidc, "5f1b2c3d-0000-4000-8000-000000000023", "history-reviewer",
    )
    assert client.get(_url(site, page), **token).status_code == 200
    denied = client.post(
        _url(site, page, "revisions/1/restore/"),
        {},
        content_type="application/json",
        HTTP_IF_MATCH=f'"cms-content-{page.pk}-r1"',
        **token,
    )
    assert denied.status_code == 403
