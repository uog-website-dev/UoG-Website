"""A signed realm role never widens CMS scope beyond persisted grants."""
from datetime import timedelta
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied
from django.core.management import call_command
from django.utils import timezone

from apps.api.models import Post
from apps.authorization.models import AuthorizationAuditEvent, Role, UserRoleAssignment
from apps.cms.models import ContentRole, ContentStatus, Page, SiteContentRoleAssignment
from apps.cms.services.pages import create_page
from apps.cms.services.workflow import transition_content
from apps.sites.models import Module
from apps.sites.services.modules import enable_module_for_site


pytestmark = pytest.mark.django_db

PAGES = "/api/v1/sites/{site}/pages/"
POSTS = "/api/v1/sites/{site}/posts/"
WORKFLOW = "/api/v1/cms/sites/{site}/content/{content}/workflow/"
REVISIONS = "/api/v1/cms/sites/{site}/content/{content}/revisions/"
ROLES = "/api/v1/cms/sites/{site}/content-roles/"


def _enable(code, *sites):
    module = Module.objects.get(code=code)
    if module.status != Module.Status.IMPLEMENTED:
        module.status = Module.Status.IMPLEMENTED
        module.save(update_fields=("status",))
    if not module.is_enabled:
        module.is_enabled = True
        module.save(update_fields=("is_enabled",))
    for site in sites:
        enable_module_for_site(site.pk, module.pk)


def _identity(oidc, username, *, roles):
    return oidc.header(
        sub=str(uuid4()),
        preferred_username=username,
        email=f"{username}@uog.et",
        realm_access={"roles": list(roles)},
    )


@pytest.fixture
def realm_admin(client, oidc, sites):
    """Site A viewer and author whose token also carries platform-admin."""
    call_command("seed_rbac", verbosity=0)
    site_a, site_b = sites
    _enable("PAGES", site_a, site_b)
    _enable("POSTS", site_a, site_b)
    header = _identity(oidc, "site-a-viewer", roles=["platform-admin"])
    assert client.get("/api/me/", **header).status_code == 200
    user = get_user_model().objects.get(username="site-a-viewer")
    UserRoleAssignment.objects.create(
        user=user,
        role=Role.objects.get(code="viewer"),
        scope=UserRoleAssignment.Scope.SITE,
        site=site_a,
        organization=site_a.organization_unit,
    )
    SiteContentRoleAssignment.objects.create(
        site=site_a, user=user, role=ContentRole.AUTHOR,
    )
    owner = get_user_model().objects.create_user(username="site-b-author")
    SiteContentRoleAssignment.objects.create(
        site=site_b, user=owner, role=ContentRole.AUTHOR,
    )
    foreign = create_page(site=site_b, title="Site B page", slug="site-b-page", actor=owner)
    return client, header, user, site_a, site_b, foreign


def test_realm_platform_admin_cannot_read_or_mutate_another_site(realm_admin):
    client, header, user, site_a, site_b, foreign = realm_admin
    pages_before = Page.objects.count()
    posts_before = Post.objects.count()

    listed = client.get(PAGES.format(site=site_b.pk), **header)
    assert listed.status_code == 403
    created = client.post(
        PAGES.format(site=site_b.pk),
        {"title": "Cross-site draft", "slug": "cross-site-draft"},
        content_type="application/json",
        **header,
    )
    assert created.status_code == 403
    assert Page.objects.count() == pages_before
    assert not Page.objects.filter(slug="cross-site-draft").exists()

    retrieved = client.get(f"{PAGES.format(site=site_b.pk)}{foreign.pk}/", **header)
    assert retrieved.status_code == 403
    moved = client.patch(
        f"{PAGES.format(site=site_b.pk)}{foreign.pk}/",
        {"title": "Moved by claim", "parent": None},
        content_type="application/json",
        HTTP_IF_MATCH=f'"cms-page-{foreign.pk}-r{foreign.revision_number}"',
        **header,
    )
    assert moved.status_code == 403
    foreign.refresh_from_db()
    assert foreign.title == "Site B page"

    reviewed = client.post(
        WORKFLOW.format(site=site_b.pk, content=foreign.pk),
        {"action": "submit"},
        content_type="application/json",
        **header,
    )
    assert reviewed.status_code == 403
    assert Page.objects.get(pk=foreign.pk).status == ContentStatus.DRAFT
    history = client.get(
        REVISIONS.format(site=site_b.pk, content=foreign.pk), **header,
    )
    assert history.status_code == 403
    roles = client.get(ROLES.format(site=site_b.pk), **header)
    assert roles.status_code == 403

    posted = client.post(
        POSTS.format(site=site_b.pk),
        {"title": "Foreign post", "slug": "foreign-post", "content": "no"},
        content_type="application/json",
        **header,
    )
    assert posted.status_code == 403
    assert Post.objects.count() == posts_before

    own = client.post(
        PAGES.format(site=site_a.pk),
        {"title": "Own draft", "slug": "own-draft"},
        content_type="application/json",
        **header,
    )
    assert own.status_code == 201, own.content
    submitted = client.post(
        f"{PAGES.format(site=site_a.pk)}{own.json()['id']}/workflow/",
        {"action": "submit"},
        content_type="application/json",
        **header,
    )
    assert submitted.status_code == 200, submitted.content
    SiteContentRoleAssignment.objects.create(
        site=site_a, user=user, role=ContentRole.REVIEWER,
    )
    self_review = client.post(
        f"{PAGES.format(site=site_a.pk)}{own.json()['id']}/workflow/",
        {"action": "approve"},
        content_type="application/json",
        **header,
    )
    assert self_review.status_code == 403
    assert Page.objects.get(pk=own.json()["id"]).status == ContentStatus.IN_REVIEW

    denial = AuthorizationAuditEvent.objects.filter(
        actor=user, action="CMS_AUTHORIZE", outcome="DENY", site_id=str(site_b.pk),
    )
    assert denial.exists()
    assert user.is_staff is False
    assert not UserRoleAssignment.objects.filter(
        user=user, role__code="platform-administrator",
    ).exists()


def test_realm_role_without_any_database_grant_cannot_administer_cms(
    client, oidc, sites,
):
    call_command("seed_rbac", verbosity=0)
    site_a, site_b = sites
    _enable("PAGES", site_b)
    header = _identity(oidc, "claim-only-admin", roles=["platform-admin"])
    assert client.get("/api/me/", **header).status_code == 200
    user = get_user_model().objects.get(username="claim-only-admin")
    user.is_staff = True
    user.is_superuser = True
    user.save(update_fields=("is_staff", "is_superuser"))
    before = Page.objects.count()
    response = client.post(
        PAGES.format(site=site_b.pk),
        {"title": "Claim only", "slug": "claim-only"},
        content_type="application/json",
        **header,
    )
    assert response.status_code == 403
    assert Page.objects.count() == before
    assert client.get(PAGES.format(site=site_a.pk), **header).status_code == 403


def test_platform_grant_expires_and_revocation_close_cms_access(
    client, oidc, sites,
):
    call_command("seed_rbac", verbosity=0)
    site, _other = sites
    _enable("PAGES", site)
    header = _identity(oidc, "expiring-admin", roles=["platform-viewer"])
    assert client.get("/api/me/", **header).status_code == 200
    user = get_user_model().objects.get(username="expiring-admin")
    role = Role.objects.get(code="platform-administrator")
    assignment = UserRoleAssignment.objects.create(
        user=user, role=role, scope=UserRoleAssignment.Scope.PLATFORM,
        expires_at=timezone.now() + timedelta(days=1),
    )
    UserRoleAssignment.objects.filter(pk=assignment.pk).update(
        expires_at=timezone.now() - timedelta(minutes=1),
    )
    assert client.get(PAGES.format(site=site.pk), **header).status_code == 403
    UserRoleAssignment.objects.filter(pk=assignment.pk).update(expires_at=None)
    assignment.refresh_from_db()
    created = client.post(
        PAGES.format(site=site.pk),
        {"title": "Granted", "slug": "granted"},
        content_type="application/json",
        **header,
    )
    assert created.status_code == 201, created.content
    assignment.revoked_at = timezone.now()
    assignment.save(update_fields=("revoked_at",))
    before = Page.objects.count()
    denied = client.post(
        PAGES.format(site=site.pk),
        {"title": "After revoke", "slug": "after-revoke"},
        content_type="application/json",
        **header,
    )
    assert denied.status_code == 403
    assert Page.objects.count() == before
    role.is_active = False
    assignment.revoked_at = None
    assignment.save(update_fields=("revoked_at",))
    role.save(update_fields=("is_active",))
    assert client.get(PAGES.format(site=site.pk), **header).status_code == 403


def test_token_role_string_does_not_authorize_the_workflow_service(sites):
    site, _other = sites
    actor = get_user_model().objects.create_user(username="service-claim")
    page = create_page(site=site, title="Service", slug="service", actor=actor)
    with pytest.raises(PermissionDenied):
        transition_content(
            page.pk, action="submit", actor=actor, roles={"platform-admin"},
        )
    assert Page.objects.get(pk=page.pk).status == ContentStatus.DRAFT
