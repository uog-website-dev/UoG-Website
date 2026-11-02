"""HTTP integration tests: validated identity, Site roles and workflow."""
import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError

from apps.api.models import Category, Post, Tag
from apps.audit.models import AuditEvent
from apps.cms.models import (
    ContentRole,
    ContentStatus,
    Page,
    PublishedContentSnapshot,
    SiteContentRoleAssignment,
)
from apps.cms.services.pages import create_page
from apps.cms.services.publication_cache import current_publication_version
from apps.sites.models import Module
from apps.sites.services.modules import disable_module_for_site, enable_module_for_site


pytestmark = pytest.mark.django_db

BASE = "/api/v1/cms/sites/"


@pytest.fixture
def platform_admin(cms_platform_admin):
    return cms_platform_admin


def _role_url(site):
    return f"{BASE}{site.pk}/content-roles/"


def _workflow_url(site, content):
    return f"{BASE}{site.pk}/content/{content.pk}/workflow/"


def test_anonymous_and_non_admin_cannot_manage_site_role_assignments(
    client, oidc, sites,
):
    site, _ = sites
    anonymous = client.get(_role_url(site))
    assert anonymous.status_code == 401
    denied = client.get(
        _role_url(site),
        **oidc.header(realm_access={"roles": ["platform-viewer"]}),
    )
    assert denied.status_code == 403
    denied = client.post(
        _role_url(site),
        {"user_id": 1, "role": ContentRole.AUTHOR},
        content_type="application/json",
        **oidc.header(realm_access={"roles": ["platform-viewer"]}),
    )
    assert denied.status_code == 403


def test_platform_admin_manages_roles_with_site_scoping_and_strict_input(
    platform_admin, sites,
):
    site, other_site = sites
    platform_admin.get("/api/me/")
    user = get_user_model().objects.get(username="devuser")
    response = platform_admin.post(
        _role_url(site),
        {"user_id": user.pk, "role": ContentRole.AUTHOR},
        content_type="application/json",
    )
    assert response.status_code == 201, response.content
    assignment_id = response.json()["id"]
    assert response.json()["site"] == site.pk

    listed = platform_admin.get(_role_url(site))
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [assignment_id]

    duplicate = platform_admin.post(
        _role_url(site),
        {"user_id": user.pk, "role": ContentRole.AUTHOR},
        content_type="application/json",
    )
    assert duplicate.status_code == 400
    extra_role = platform_admin.post(
        _role_url(site),
        {
            "user_id": user.pk,
            "role": ContentRole.AUTHOR,
            "roles": ["platform-admin"],
        },
        content_type="application/json",
    )
    assert extra_role.status_code == 400

    foreign_delete = platform_admin.delete(
        f"{BASE}{other_site.pk}/content-roles/{assignment_id}/",
    )
    assert foreign_delete.status_code == 404
    deleted = platform_admin.delete(
        f"{BASE}{site.pk}/content-roles/{assignment_id}/",
    )
    assert deleted.status_code == 204
    assert not SiteContentRoleAssignment.objects.filter(pk=assignment_id).exists()


def _enable_pages(site):
    from apps.sites.models import Module
    from apps.sites.services.modules import enable_module_for_site

    module = Module.objects.get(code="PAGES")
    if not module.is_enabled:
        module.is_enabled = True
        module.save(update_fields=("is_enabled",))
    enable_module_for_site(site.pk, module.pk)


def test_site_role_workflow_uses_validated_token_and_never_body_roles(
    client, oidc, sites, cms_platform_admin,
):
    site, other_site = sites
    _enable_pages(site)
    platform_admin = cms_platform_admin
    author = get_user_model().objects.get(username="devuser")
    role_response = platform_admin.post(
        _role_url(site),
        {"user_id": author.pk, "role": ContentRole.AUTHOR},
        content_type="application/json",
    )
    assert role_response.status_code == 201, role_response.content

    page = create_page(
        site=site, title="Admissions", slug="admissions", actor=author,
    )
    response = client.post(
        _workflow_url(site, page),
        {"action": "submit"},
        content_type="application/json",
        **oidc.header(realm_access={"roles": ["platform-viewer"]}),
    )
    assert response.status_code == 200, response.content
    assert response.json()["status"] == ContentStatus.IN_REVIEW
    audit = AuditEvent.objects.get(
        entity_id=str(page.pk), action="CONTENT_SUBMITTED",
    )
    assert audit.actor_id == str(author.pk)
    assert audit.after["site_id"] == site.pk

    forged_role = client.post(
        _workflow_url(site, page),
        {
            "action": "approve",
            "roles": ["platform-admin"],
        },
        content_type="application/json",
        **oidc.header(realm_access={"roles": ["platform-viewer"]}),
    )
    assert forged_role.status_code == 400
    denied = client.post(
        _workflow_url(site, page),
        {"action": "approve"},
        content_type="application/json",
        **oidc.header(realm_access={"roles": ["platform-viewer"]}),
    )
    assert denied.status_code == 403

    cross_site = client.post(
        _workflow_url(other_site, page),
        {"action": "approve"},
        content_type="application/json",
        **oidc.header(),
    )
    assert cross_site.status_code == 404


def test_http_review_publish_flow_and_publish_retry(
    platform_admin, oidc, pages_module, sites,
):
    site, _ = sites
    _enable_pages(site)
    platform_admin.get("/api/me/")
    author = get_user_model().objects.get(username="devuser")
    identities = {}
    for role, subject, username in (
        (ContentRole.REVIEWER, "5f1b2c3d-0000-4000-8000-000000000002", "reviewer"),
        (ContentRole.PUBLISHER, "5f1b2c3d-0000-4000-8000-000000000003", "publisher"),
    ):
        identities[role] = (subject, username)
    for role, (_subject, username) in identities.items():
        user = get_user_model().objects.create_user(username=username)
        result = platform_admin.post(
            _role_url(site),
            {"user_id": user.pk, "role": role},
            content_type="application/json",
        )
        assert result.status_code == 201, result.content

    page = create_page(
        site=site, title="Admissions", slug="admissions", actor=author,
    )
    assert platform_admin.post(
        _workflow_url(site, page), {"action": "submit"},
        content_type="application/json",
    ).status_code == 200
    reviewer = identities[ContentRole.REVIEWER][0]
    approved = platform_admin.post(
        _workflow_url(site, page),
        {"action": "approve"},
        content_type="application/json",
        **_token_header(oidc, reviewer, "reviewer"),
    )
    assert approved.status_code == 200, approved.content

    published = platform_admin.post(
        _workflow_url(site, page),
        {"action": "publish"},
        content_type="application/json",
        **_token_header(
            oidc, identities[ContentRole.PUBLISHER][0], "publisher",
        ),
    )
    assert published.status_code == 200, published.content
    retry = platform_admin.post(
        _workflow_url(site, page),
        {"action": "publish"},
        content_type="application/json",
        **_token_header(
            oidc, identities[ContentRole.PUBLISHER][0], "publisher",
        ),
    )
    assert retry.status_code == 200, retry.content
    assert Page.objects.get(pk=page.pk).status == ContentStatus.PUBLISHED
    assert page.publication_snapshots.count() == 1
    assert page.workflow_transitions.count() == 3


def test_post_workflow_uses_roles_post_module_snapshots_audit_and_idempotency(
    client, oidc, posts_module, sites,
):
    site, _other = sites
    users = {
        ContentRole.AUTHOR: get_user_model().objects.create_user(username="post-flow-author"),
        ContentRole.REVIEWER: get_user_model().objects.create_user(username="post-flow-reviewer"),
        ContentRole.PUBLISHER: get_user_model().objects.create_user(username="post-flow-publisher"),
    }
    for role, user in users.items():
        SiteContentRoleAssignment.objects.create(site=site, user=user, role=role)

    category = Category.objects.create(site=site, code="FLOW_NEWS", name="Flow News")
    tag = Tag.objects.create(site=site, code="FLOW", name="Workflow")
    post = Post.objects.create(
        site=site, title="Workflow story", slug="workflow-story",
        excerpt="A summary", content="The immutable published body.",
        author=users[ContentRole.AUTHOR], created_by=users[ContentRole.AUTHOR],
        seo={"meta_title": "Workflow story"},
    )
    post.categories.add(category)
    post.tags.add(tag)
    url = _workflow_url(site, post)
    foreign = Post.objects.create(
        site=_other, title="Foreign workflow", slug="foreign-workflow", content="Body",
    )

    def as_role(role):
        user = users[role]
        return oidc.header(
            sub=f"post-workflow-{role.lower()}",
            preferred_username=user.username,
            email=f"{user.username}@uog.et",
            realm_access={"roles": ["platform-viewer"]},
        )

    assert client.post(
        _workflow_url(site, foreign), {"action": "submit"},
        content_type="application/json", **as_role(ContentRole.AUTHOR),
    ).status_code == 404

    # Posts workflow is independent from PAGES; this Site has only POSTS on.
    refused_early_publish = client.post(
        url, {"action": "publish"}, content_type="application/json",
        **as_role(ContentRole.PUBLISHER),
    )
    assert refused_early_publish.status_code == 409
    submitted = client.post(
        url, {"action": "submit"}, content_type="application/json",
        **as_role(ContentRole.AUTHOR),
    )
    assert submitted.status_code == 200, submitted.content
    assert submitted.json()["status"] == ContentStatus.IN_REVIEW
    assert submitted.json()["title"] == "Workflow story"

    self_review = client.post(
        url, {"action": "approve"}, content_type="application/json",
        **as_role(ContentRole.AUTHOR),
    )
    assert self_review.status_code == 403
    approved = client.post(
        url, {"action": "approve", "comment": "Reviewed."},
        content_type="application/json", **as_role(ContentRole.REVIEWER),
    )
    assert approved.status_code == 200, approved.content
    wrong_role_publish = client.post(
        url, {"action": "publish"}, content_type="application/json",
        **as_role(ContentRole.REVIEWER),
    )
    assert wrong_role_publish.status_code == 403

    initial_version = current_publication_version(site.pk, post.locale)
    published = client.post(
        url, {"action": "publish"}, content_type="application/json",
        **as_role(ContentRole.PUBLISHER),
    )
    assert published.status_code == 200, published.content
    snapshot = PublishedContentSnapshot.objects.get(content_id=post.pk, version=1)
    assert snapshot.payload["content_type"] == "api.post"
    assert snapshot.payload["title"] == "Workflow story"
    assert snapshot.payload["content"] == "The immutable published body."
    assert snapshot.payload["categories"][0]["id"] == str(category.pk)
    assert snapshot.payload["tags"][0]["id"] == str(tag.pk)
    snapshot.payload["title"] = "Tampered"
    with pytest.raises(ValidationError):
        snapshot.save()
    snapshot.refresh_from_db()
    assert snapshot.payload["title"] == "Workflow story"
    assert current_publication_version(site.pk, post.locale) == initial_version + 1

    retry = client.post(
        url, {"action": "publish"}, content_type="application/json",
        **as_role(ContentRole.PUBLISHER),
    )
    assert retry.status_code == 200
    assert PublishedContentSnapshot.objects.filter(content_id=post.pk).count() == 1
    assert AuditEvent.objects.filter(
        entity_id=str(post.pk), action="CONTENT_PUBLISHED",
    ).count() == 1
    assert current_publication_version(site.pk, post.locale) == initial_version + 1

    history = client.get(
        f"/api/v1/cms/sites/{site.pk}/content/{post.pk}/workflow-history/",
        **as_role(ContentRole.PUBLISHER),
    )
    assert history.status_code == 200, history.content
    assert any(item["comment"] == "Reviewed." for item in history.json())
    assert client.get(
        f"/api/v1/cms/sites/{site.pk}/content/{foreign.pk}/workflow-history/",
        **as_role(ContentRole.AUTHOR),
    ).status_code == 404

    disable_module_for_site(site.pk, posts_module.pk)
    assert client.get(
        f"/api/v1/cms/sites/{site.pk}/content/{post.pk}/workflow-history/",
        **as_role(ContentRole.PUBLISHER),
    ).status_code == 400
    blocked = client.post(
        url, {"action": "unpublish"}, content_type="application/json",
        **as_role(ContentRole.PUBLISHER),
    )
    assert blocked.status_code == 400
    enable_module_for_site(site.pk, posts_module.pk)
    unpublished = client.post(
        url, {"action": "unpublish"}, content_type="application/json",
        **as_role(ContentRole.PUBLISHER),
    )
    assert unpublished.status_code == 200, unpublished.content
    assert unpublished.json()["status"] == ContentStatus.UNPUBLISHED
    assert AuditEvent.objects.filter(
        entity_id=str(post.pk), action="CONTENT_UNPUBLISHED",
    ).count() == 1
    assert current_publication_version(site.pk, post.locale) == initial_version + 2


def _token_header(oidc, subject, username):
    return oidc.header(
        sub=subject,
        preferred_username=username,
        email=f"{username}@uog.et",
        realm_access={"roles": ["platform-viewer"]},
    )
