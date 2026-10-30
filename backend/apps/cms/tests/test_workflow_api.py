"""HTTP integration tests: validated identity, Site roles and workflow."""
import pytest
from django.contrib.auth import get_user_model

from apps.audit.models import AuditEvent
from apps.cms.models import (
    ContentRole,
    ContentStatus,
    Page,
    SiteContentRoleAssignment,
)
from apps.cms.services.pages import create_page


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


def test_site_role_workflow_uses_validated_token_and_never_body_roles(
    client, oidc, sites, cms_platform_admin,
):
    site, other_site = sites
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


def _token_header(oidc, subject, username):
    return oidc.header(
        sub=subject,
        preferred_username=username,
        email=f"{username}@uog.et",
        realm_access={"roles": ["platform-viewer"]},
    )
