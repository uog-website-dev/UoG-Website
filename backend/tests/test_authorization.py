"""Database-backed authorization contract and security regression tests."""
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.authorization.access import authorized_organization_ids, authorized_site_ids
from apps.authorization.catalog import CAPABILITIES, STANDARD_ROLES
from apps.authorization.models import AuthorizationAuditEvent, Permission, Role, RolePermission, UserRoleAssignment
from apps.authorization.services import permission_granted
from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.sites.models import Site

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def actor(client, oidc):
    client.get("/api/me/", **oidc.header())
    client.defaults.update(oidc.header())
    return client, User.objects.get(username="devuser")


def seeded_role(code):
    call_command("seed_rbac", verbosity=0)
    return Role.objects.get(code=code)


def grant(user, role, scope=UserRoleAssignment.Scope.PLATFORM, organization=None, site=None, expires_at=None):
    return UserRoleAssignment.objects.create(
        user=user, role=role, scope=scope, organization=organization, site=site,
        expires_at=expires_at,
    )


def organization_tree():
    university_type, _ = OrganizationType.objects.get_or_create(code="UNIVERSITY", defaults={"name": "University"})
    college_type, _ = OrganizationType.objects.get_or_create(code="COLLEGE", defaults={"name": "College"})
    root = OrganizationUnit.objects.create(code="UOG", name="University", organization_type=university_type)
    college = OrganizationUnit.objects.create(code="RBAC-COLLEGE", name="College", organization_type=college_type, parent=root)
    return root, college


def test_seed_is_idempotent_and_matches_all_seven_reviewed_templates():
    call_command("seed_rbac", verbosity=0)
    initial = (Permission.objects.count(), Role.objects.count(), RolePermission.objects.count())
    call_command("seed_rbac", verbosity=0)
    assert (Permission.objects.count(), Role.objects.count(), RolePermission.objects.count()) == initial
    assert Role.objects.filter(is_system=True).count() == 7
    for code, _name, _description, expected in STANDARD_ROLES:
        assert set(RolePermission.objects.filter(role__code=code).values_list("permission__code", flat=True)) == set(expected)
    assert Permission.objects.count() == len(CAPABILITIES)


def test_unknown_permissions_expired_and_revoked_assignments_fail_closed():
    call_command("seed_rbac", verbosity=0)
    user = User.objects.create_user(username="rbac-user")
    editor = Role.objects.get(code="editor")
    expired = grant(user, editor, UserRoleAssignment.Scope.PLATFORM)
    UserRoleAssignment.objects.filter(pk=expired.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
    assert permission_granted(user, "content.pages.create", audit=False) is False
    assert permission_granted(user, "content.pages.not-registered", audit=False) is False
    expired.revoked_at = timezone.now()
    expired.save(update_fields=["revoked_at"])
    active = grant(user, editor, UserRoleAssignment.Scope.PLATFORM)
    assert permission_granted(user, "content.pages.create", audit=False) is True
    active.revoked_at = timezone.now()
    active.save(update_fields=["revoked_at"])
    assert permission_granted(user, "content.pages.create", audit=False) is False


def test_organization_and_site_scopes_do_not_leak_to_siblings_or_platform():
    call_command("seed_rbac", verbosity=0)
    user = User.objects.create_user(username="scoped-editor")
    root, college = organization_tree()
    other = OrganizationUnit.objects.create(code="OTHER-COLLEGE", name="Other", organization_type=college.organization_type, parent=root)
    site = Site.objects.create(code="SCOPED", name="Scoped", organization_unit=college)
    other_site = Site.objects.create(code="OTHER", name="Other", organization_unit=other)
    editor = Role.objects.get(code="editor")
    grant(user, editor, UserRoleAssignment.Scope.ORGANIZATION, organization=college)

    assert permission_granted(user, "content.pages.create", organization_id=college.pk, audit=False)
    assert permission_granted(user, "content.pages.create", organization_id=college.pk, site_id=site.pk, audit=False)
    assert not permission_granted(user, "content.pages.create", organization_id=other.pk, site_id=other_site.pk, audit=False)
    assert not permission_granted(user, "content.pages.create", audit=False)
    assert set(authorized_organization_ids(user, "content.pages.create")) == {college.pk}
    assert set(authorized_site_ids(user, "content.pages.create")) == {site.pk}


def test_platform_scope_is_explicit_and_audited():
    call_command("seed_rbac", verbosity=0)
    user = User.objects.create_user(username="platform-audited")
    role = seeded_role("platform-administrator")
    grant(user, role)
    before = AuthorizationAuditEvent.objects.filter(action="PLATFORM_ADMIN_BYPASS").count()
    assert permission_granted(user, "platform.organizations.view", audit=True)
    assert AuthorizationAuditEvent.objects.filter(action="PLATFORM_ADMIN_BYPASS").count() == before + 1
    assert authorized_organization_ids(user, "platform.organizations.view") is None


def test_api_rejects_keycloak_role_claims_and_requires_database_roles(actor):
    client, user = actor
    token_with_claim = client.get(
        "/api/v1/organizations/",
        HTTP_AUTHORIZATION=client.defaults["HTTP_AUTHORIZATION"],
    )
    assert token_with_claim.status_code == 403
    assert not user.is_staff


def test_page_writes_need_rbac_and_editor_cannot_publish(actor):
    client, user = actor
    response = client.post("/api/pages/", {
        "title": "Unassigned", "slug": "unassigned", "content": "body",
    }, content_type="application/json")
    assert response.status_code == 403

    call_command("seed_rbac", verbosity=0)
    grant(user, Role.objects.get(code="editor"))
    assert permission_granted(user, "content.pages.create", audit=False) is True
    unpublished = client.post("/api/pages/", {
        "title": "Draft", "slug": "draft-page", "content": "body", "is_published": False,
    }, content_type="application/json")
    assert unpublished.status_code == 201, unpublished.content
    published = client.post("/api/pages/", {
        "title": "Published", "slug": "editor-published", "content": "body", "is_published": True,
    }, content_type="application/json")
    assert published.status_code == 403


def test_page_site_scope_is_derived_from_site_and_wrong_site_denies(actor):
    client, user = actor
    call_command("seed_rbac", verbosity=0)
    root, college = organization_tree()
    other = OrganizationUnit.objects.create(code="OTHER-COLLEGE", name="Other", organization_type=college.organization_type, parent=root)
    site = Site.objects.create(code="EDITOR-SITE", name="Editor site", organization_unit=college)
    other_site = Site.objects.create(code="OTHER-SITE", name="Other site", organization_unit=other)
    role = Role.objects.create(code="scoped-page-editor", name="Scoped Page Editor")
    RolePermission.objects.create(role=role, permission=Permission.objects.get(code="content.pages.create"))
    grant(user, role, UserRoleAssignment.Scope.SITE, organization=college, site=site)

    allowed = client.post("/api/pages/", {
        "title": "Scoped", "slug": "scoped-page", "content": "body", "site": site.pk,
    }, content_type="application/json")
    assert allowed.status_code == 201, allowed.content
    denied = client.post("/api/pages/", {
        "title": "Other", "slug": "other-page", "content": "body", "site": other_site.pk,
    }, content_type="application/json")
    assert denied.status_code == 403


def test_permission_catalog_is_read_only_and_unknown_codes_cannot_be_added(actor):
    client, user = actor
    call_command("seed_rbac", verbosity=0)
    grant(user, seeded_role("platform-administrator"))
    from apps.authorization.catalog import CAPABILITY_CODES
    assert client.get("/api/v1/authorization/permissions/").status_code == 200
    role_response = client.post("/api/v1/authorization/roles/", {
        "code": "custom-editor", "name": "Custom Editor", "description": "Safe role",
    }, content_type="application/json")
    assert role_response.status_code == 201
    custom_role = Role.objects.get(code="custom-editor")
    permissions_response = client.put(
        f"/api/v1/authorization/roles/{custom_role.code}/permissions/",
        {"permissions": ["content.pages.create", "invented.capability.run"]},
        content_type="application/json",
    )
    assert permissions_response.status_code == 400
    assert not custom_role.permission_links.exists()
    assert set(CAPABILITY_CODES) == set(Permission.objects.values_list("code", flat=True))


def test_role_administrator_cannot_modify_system_templates_or_grant_self(actor):
    client, user = actor
    call_command("seed_rbac", verbosity=0)
    grant(user, seeded_role("platform-administrator"))
    platform_role = Role.objects.get(code="platform-administrator")
    changed = client.patch(
        f"/api/v1/authorization/roles/{platform_role.pk}/",
        {"name": "Overridden"}, content_type="application/json",
    )
    assert changed.status_code == 404
    self_assignment = client.post("/api/v1/authorization/assignments/", {
        "user": user.pk, "role": Role.objects.get(code="viewer").pk, "scope": "PLATFORM",
    }, content_type="application/json")
    assert self_assignment.status_code == 403
