"""
API tests for the Keycloak-protected endpoints.

They cover the contract the frontends rely on: a valid access token is
accepted, an invalid or missing one is not, and the claims end up in a
local account.
"""
import time

import pytest
from django.contrib.auth import get_user_model

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
    assert body["is_staff"] is True

    user = User.objects.get(username="devuser")
    assert user.groups.filter(name="platform-admin").exists()
    assert OIDCIdentity.objects.get(user=user).subject == SUBJECT


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
def test_the_admin_overview_requires_the_admin_role(client, oidc):
    without_role = client.get(
        "/api/admin/overview/",
        **oidc.header(realm_access={"roles": ["platform-viewer"]}),
    )
    assert without_role.status_code == 403

    with_role = client.get("/api/admin/overview/", **oidc.header())
    assert with_role.status_code == 200
    assert with_role.json()["requested_by"] == "devuser"


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
    response = client.post(
        "/api/pages/",
        {"title": "From Keycloak", "slug": "from-keycloak", "content": "hello"},
        content_type="application/json",
        **oidc.header(),
    )
    assert response.status_code == 201
    assert response.json()["slug"] == "from-keycloak"
