"""Assignment effective-permission route, exercised over authenticated HTTP.

These requests hit ``/api/v1/authorization/assignments/users/{id}/effective/``.
The self-service ``/me/permissions/`` route is not a substitute.
"""
from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import Client
from django.utils import timezone

from apps.authorization.catalog import EDITOR, PLATFORM_ADMIN, REVIEWER, VIEWER
from apps.authorization.models import Permission, Role, UserRoleAssignment
from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.sites.models import Site

pytestmark = pytest.mark.django_db
User = get_user_model()


def _grant(user, role, scope, organization=None, site=None):
    return UserRoleAssignment.objects.create(
        user=user, role=role, scope=scope, organization=organization, site=site,
    )


def _user(username):
    return User.objects.create_user(username=username, email=f"{username}@uog.et")


@pytest.fixture
def world(client, oidc):
    call_command("seed_rbac", verbosity=0)
    client.get("/api/me/", **oidc.header())
    admin = User.objects.get(username="devuser")
    _grant(admin, Role.objects.get(code="platform-administrator"), UserRoleAssignment.Scope.PLATFORM)
    client.defaults.update(oidc.header())
    university, _ = OrganizationType.objects.get_or_create(code="UNIVERSITY", defaults={"name": "University"})
    college, _ = OrganizationType.objects.get_or_create(code="COLLEGE", defaults={"name": "College"})
    root = OrganizationUnit.objects.create(code="EFF-UOG", name="University", organization_type=university)
    owner = OrganizationUnit.objects.create(code="EFF-CI", name="Informatics", organization_type=college, parent=root)
    other_owner = OrganizationUnit.objects.create(code="EFF-MED", name="Medicine", organization_type=college, parent=root)
    site = Site.objects.create(code="EFF-A", name="Site A", organization_unit=owner)
    other = Site.objects.create(code="EFF-B", name="Site B", organization_unit=other_owner)
    roles = {code: Role.objects.get(code=code) for code in ("editor", "reviewer", "viewer")}
    people = {
        "editor": _user("eff-editor"),
        "reviewer": _user("eff-reviewer"),
        "viewer": _user("eff-viewer"),
    }
    for code, person in people.items():
        _grant(person, roles[code], UserRoleAssignment.Scope.SITE, organization=owner, site=site)
    return SimpleNamespace(
        client=client, oidc=oidc, admin=admin, owner=owner, other_owner=other_owner,
        site=site, other=other, people=people, roles=roles,
    )


def _effective(client, user_id, **params):
    return client.get(
        f"/api/v1/authorization/assignments/users/{user_id}/effective/",
        params,
    )


def _codes(response):
    assert response.status_code == 200, response.content
    assert response["Cache-Control"] == "private, no-store"
    body = response.json()
    assert "error" not in body
    return body


def test_site_roles_return_their_registered_permissions(world):
    expected = {"editor": EDITOR, "reviewer": REVIEWER, "viewer": VIEWER}
    matrix = {}
    for code, person in world.people.items():
        body = _codes(_effective(world.client, person.pk, scope="SITE", site=world.site.pk))
        assert body["user"] == person.pk
        assert body["site"] == world.site.pk
        assert body["organization"] == world.owner.pk
        assert set(body["permissions"]) == set(expected[code])
        matrix[code] = body["permissions"]
    assert matrix["editor"] != matrix["viewer"]
    assert "content.pages.create" in matrix["editor"]
    assert "content.pages.create" not in matrix["reviewer"]
    assert "content.pages.publish" not in matrix["editor"]
    assert "platform.users.view" in matrix["viewer"]
    assert "platform.users.view" not in matrix["editor"]


def test_platform_administrator_policy_is_the_approved_capability_set(world):
    body = _codes(_effective(world.client, world.admin.pk, scope="PLATFORM"))
    assert body["organization"] is None and body["site"] is None
    assert set(body["permissions"]) == set(PLATFORM_ADMIN)
    assert "content.pages.approve" not in body["permissions"]
    assert "content.media.upload" in body["permissions"]
    site_body = _codes(_effective(world.client, world.admin.pk, scope="SITE", site=world.site.pk))
    assert set(site_body["permissions"]) == set(PLATFORM_ADMIN)


def test_scope_ownership_expiry_revocation_and_inactive_grants(world):
    editor = world.people["editor"]
    covered = _codes(_effective(
        world.client, editor.pk, scope="SITE", site=world.site.pk, organization=world.owner.pk,
    ))
    assert set(covered["permissions"]) == set(EDITOR)
    sibling = _codes(_effective(world.client, editor.pk, scope="SITE", site=world.other.pk))
    assert sibling["permissions"] == []
    assert sibling["organization"] == world.other_owner.pk
    organization_only = _codes(_effective(
        world.client, editor.pk, scope="ORGANIZATION", organization=world.owner.pk,
    ))
    assert organization_only["permissions"] == []
    platform = _codes(_effective(world.client, editor.pk, scope="PLATFORM"))
    assert platform["permissions"] == []

    college_editor = _user("eff-college-editor")
    _grant(
        college_editor, world.roles["editor"], UserRoleAssignment.Scope.ORGANIZATION,
        organization=world.owner,
    )
    inherited = _codes(_effective(world.client, college_editor.pk, scope="SITE", site=world.site.pk))
    assert set(inherited["permissions"]) == set(EDITOR)
    outside = _codes(_effective(world.client, college_editor.pk, scope="SITE", site=world.other.pk))
    assert outside["permissions"] == []

    Permission.objects.filter(code="content.pages.create").update(is_active=False)
    without_create = _codes(_effective(world.client, editor.pk, scope="SITE", site=world.site.pk))
    assert "content.pages.create" not in without_create["permissions"]
    assert "content.pages.update" in without_create["permissions"]
    Permission.objects.filter(code="content.pages.create").update(is_active=True)

    world.roles["editor"].is_active = False
    world.roles["editor"].save(update_fields=["is_active"])
    assert _codes(_effective(world.client, editor.pk, scope="SITE", site=world.site.pk))["permissions"] == []
    world.roles["editor"].is_active = True
    world.roles["editor"].save(update_fields=["is_active"])

    assignment = UserRoleAssignment.objects.get(user=editor, role=world.roles["editor"])
    UserRoleAssignment.objects.filter(pk=assignment.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
    assert _codes(_effective(world.client, editor.pk, scope="SITE", site=world.site.pk))["permissions"] == []
    UserRoleAssignment.objects.filter(pk=assignment.pk).update(expires_at=None, revoked_at=timezone.now())
    assert _codes(_effective(world.client, editor.pk, scope="SITE", site=world.site.pk))["permissions"] == []


def test_invalid_users_scopes_and_foreign_inspection_do_not_disclose_grants(world):
    editor = world.people["editor"]
    route = f"/api/v1/authorization/assignments/users/{editor.pk}/effective/"
    anonymous = Client().get(route, {"scope": "SITE", "site": world.site.pk})
    assert anonymous.status_code == 401
    assert anonymous.json()["error"]["code"] == "not_authenticated"

    missing = _effective(world.client, 999999999, scope="SITE", site=world.site.pk)
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"
    malformed_user = world.client.get(
        "/api/v1/authorization/assignments/users/not-an-id/effective/",
        {"scope": "SITE", "site": world.site.pk},
    )
    assert malformed_user.status_code == 400
    assert malformed_user.json()["error"]["code"] == "validation_error"
    assert "SELECT" not in malformed_user.content.decode()
    assert "NameError" not in malformed_user.content.decode()
    assert world.client.get(
        "/api/v1/authorization/assignments/users/0/effective/",
        {"scope": "SITE", "site": world.site.pk},
    ).status_code == 400

    assert _effective(world.client, editor.pk, scope="SITE", site="abc").status_code == 400
    assert _effective(world.client, editor.pk, scope="SITE", site=999999999).status_code == 404
    assert _effective(world.client, editor.pk, scope="ORGANIZATION", organization="nope").status_code == 400
    assert _effective(world.client, editor.pk, scope="ORGANIZATION", organization=999999999).status_code == 404
    mismatch = _effective(
        world.client, editor.pk, scope="SITE", site=world.site.pk, organization=world.other_owner.pk,
    )
    assert mismatch.status_code == 400
    assert mismatch.json()["error"]["details"]["site"]
    assert _effective(world.client, editor.pk, scope="PLATFORM", site=world.site.pk).status_code == 400
    assert _effective(world.client, editor.pk, scope="ORGANIZATION", organization=world.owner.pk, site=world.site.pk).status_code == 400
    assert _effective(world.client, editor.pk, scope="SITE").status_code == 400
    assert _effective(world.client, editor.pk, scope="ELSEWHERE", site=world.site.pk).status_code == 400
    repeated = world.client.get(route + "?scope=SITE&scope=ORGANIZATION&site=" + str(world.site.pk))
    assert repeated.status_code == 400

    claim_only = _user("eff-claim")
    claim = world.oidc.header(
        sub=str(uuid4()), preferred_username=claim_only.username, email=claim_only.email,
        realm_access={"roles": ["platform-admin"]},
    )
    claimed = world.client.get(route, {"scope": "SITE", "site": world.site.pk}, **claim)
    assert claimed.status_code == 403
    assert "content.pages.create" not in claimed.content.decode()

    viewer = world.people["viewer"]
    viewer_header = world.oidc.header(
        sub=str(uuid4()), preferred_username=viewer.username, email=viewer.email,
        realm_access={"roles": []},
    )
    allowed = world.client.get(route, {"scope": "SITE", "site": world.site.pk}, **viewer_header)
    assert set(_codes(allowed)["permissions"]) == set(EDITOR)
    foreign = world.client.get(route, {"scope": "SITE", "site": world.other.pk}, **viewer_header)
    assert foreign.status_code == 403
    assert foreign.json()["error"]["code"] == "permission_denied"
    assert "content.pages.create" not in foreign.content.decode()
    assert "permissions" not in foreign.json()

    editor_header = world.oidc.header(
        sub=str(uuid4()), preferred_username=editor.username, email=editor.email,
        realm_access={"roles": ["platform-admin"]},
    )
    denied_editor = world.client.get(
        f"/api/v1/authorization/assignments/users/{viewer.pk}/effective/",
        {"scope": "SITE", "site": world.site.pk}, **editor_header,
    )
    assert denied_editor.status_code == 403
    assert "platform.users.view" not in denied_editor.content.decode()
