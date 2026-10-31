"""
API tests for the Keycloak-protected endpoints.

They cover the contract the frontends rely on: a valid access token is
accepted, an invalid or missing one is not, and the claims end up in a
local account.
"""
import time

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import override_settings

from apps.accounts.models import OIDCIdentity

User = get_user_model()

SUBJECT = "5f1b2c3d-0000-4000-8000-000000000001"


@pytest.mark.django_db
def test_me_without_a_token_is_rejected(client):
    response = client.get("/api/me/")
    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"].startswith("Bearer")


@pytest.mark.django_db
def test_me_with_a_valid_token_returns_the_identity(client, oidc):
    response = client.get("/api/me/", **oidc.header())
    assert response.status_code == 200
    body = response.json()
    assert body["username"] == "devuser"
    assert body["email"] == "devuser@uog.et"
    assert body["client_id"] == "public-web"
    assert "platform-admin" in body["roles"]
    assert body["is_staff"] is False

    user = User.objects.get(username="devuser")
    assert not user.is_staff
    assert not user.groups.exists()
    assert OIDCIdentity.objects.get(user=user).subject == SUBJECT


@pytest.mark.django_db
@override_settings(
    DEBUG=True,
    DEV_PLATFORM_ADMIN_BOOTSTRAP=True,
    DEV_PLATFORM_ADMIN_USERNAME="devuser",
)
def test_explicit_local_dev_admin_bootstrap_creates_database_assignment(client, oidc):
    from apps.authorization.access import is_platform_administrator
    from apps.authorization.models import UserRoleAssignment

    call_command("seed_rbac", verbosity=0)
    response = client.get("/api/me/", **oidc.header(realm_access={"roles": []}))
    assert response.status_code == 200
    user = User.objects.get(username="devuser")
    assert is_platform_administrator(user)
    assert UserRoleAssignment.objects.filter(
        user=user, role__code="platform-administrator",
        scope=UserRoleAssignment.Scope.PLATFORM, revoked_at__isnull=True,
    ).exists()

    other = client.get(
        "/api/me/",
        **oidc.header(
            sub="5f1b2c3d-0000-4000-8000-000000000099",
            preferred_username="another-user",
            email="another-user@uog.et",
            realm_access={"roles": ["platform-admin"]},
        ),
    )
    assert other.status_code == 200
    assert not is_platform_administrator(User.objects.get(username="another-user"))


@pytest.mark.django_db
def test_me_with_an_expired_token_is_rejected(client, oidc):
    response = client.get(
        "/api/me/", **oidc.header(exp=int(time.time()) - 60)
    )
    assert response.status_code == 401


@pytest.mark.django_db
def test_me_with_a_token_of_an_unknown_client_is_rejected(client, oidc):
    response = client.get("/api/me/", **oidc.header(azp="some-other-application"))
    assert response.status_code == 401


@pytest.mark.django_db
def test_me_with_a_token_for_another_audience_is_rejected(client, oidc):
    response = client.get("/api/me/", **oidc.header(aud="account"))
    assert response.status_code == 401


@pytest.mark.django_db
def test_the_same_subject_always_maps_to_the_same_account(client, oidc):
    client.get("/api/me/", **oidc.header())
    client.get("/api/me/", **oidc.header())
    assert User.objects.filter(username="devuser").count() == 1
    assert OIDCIdentity.objects.count() == 1


@pytest.mark.django_db
def test_a_subject_username_is_replaced_when_the_claim_arrives(client, oidc):
    client.get("/api/me/", **oidc.header(preferred_username=SUBJECT))
    user = User.objects.get()
    assert user.username == SUBJECT

    repaired = client.get("/api/me/", **oidc.header())
    assert repaired.status_code == 200
    assert repaired.json()["username"] == "devuser"
    assert User.objects.count() == 1


@pytest.mark.django_db
def test_a_renamed_keycloak_user_keeps_the_local_account(client, oidc):
    client.get("/api/me/", **oidc.header())
    renamed = client.get("/api/me/", **oidc.header(preferred_username="d.user"))
    assert renamed.status_code == 200
    # The account is looked up by the stable subject, not by the name.
    assert User.objects.count() == 1
    assert OIDCIdentity.objects.count() == 1


@pytest.mark.django_db
def test_the_admin_overview_requires_database_platform_assignment(client, oidc):
    from apps.authorization.catalog import STANDARD_ROLES
    from apps.authorization.models import Permission, Role, RolePermission, UserRoleAssignment

    denied = client.get("/api/admin/overview/", **oidc.header())
    assert denied.status_code == 403

    user = User.objects.get(username="devuser")
    role_template = next(item for item in STANDARD_ROLES if item[0] == "platform-administrator")
    role, _ = Role.objects.get_or_create(
        code=role_template[0],
        defaults={"name": role_template[1], "description": role_template[2], "is_system": True},
    )
    permissions = {p.code: p for p in Permission.objects.filter(code__in=role_template[3])}
    missing = [code for code in role_template[3] if code not in permissions]
    if missing:
        from apps.authorization.catalog import CAPABILITIES
        for capability in CAPABILITIES:
            if capability.code in missing:
                permissions[capability.code] = Permission.objects.create(
                    code=capability.code, name=capability.name, description=capability.description,
                    module=capability.module, resource_type=capability.resource_type,
                    action=capability.action, risk=capability.risk, delegable=capability.delegable,
                )
    RolePermission.objects.bulk_create(
        [RolePermission(role=role, permission=permissions[code]) for code in role_template[3]],
        ignore_conflicts=True,
    )
    UserRoleAssignment.objects.create(user=user, role=role, scope=UserRoleAssignment.Scope.PLATFORM)

    allowed = client.get("/api/admin/overview/", **oidc.header(realm_access={"roles": []}))
    assert allowed.status_code == 200
    assert allowed.json()["requested_by"] == "devuser"


@pytest.mark.django_db
def test_published_pages_stay_public(client):
    response = client.get("/api/pages/")
    assert response.status_code == 200


@pytest.mark.django_db
def test_writing_a_page_requires_a_token(client):
    response = client.post(
        "/api/pages/",
        {"title": "Intruder", "slug": "intruder", "content": "nope"},
        content_type="application/json",
    )
    assert response.status_code == 401


@pytest.mark.django_db
def test_writing_a_page_with_a_token_is_allowed(client, oidc):
    from django.core.management import call_command
    from apps.authorization.models import Role, UserRoleAssignment

    call_command("seed_rbac", verbosity=0)
    user_response = client.get("/api/me/", **oidc.header())
    user = User.objects.get(username=user_response.json()["username"])
    UserRoleAssignment.objects.create(
        user=user, role=Role.objects.get(code="platform-administrator"),
        scope=UserRoleAssignment.Scope.PLATFORM,
    )
    response = client.post(
        "/api/pages/",
        {"title": "From Keycloak", "slug": "from-keycloak", "content": "hello"},
        content_type="application/json",
        **oidc.header(),
    )
    assert response.status_code == 201
    assert response.json()["slug"] == "from-keycloak"
