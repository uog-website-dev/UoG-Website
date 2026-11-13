"""Site-scoped identity creation, provider faults, private avatars and RBAC."""
import base64
import io
from uuid import uuid4
from unittest.mock import Mock
import pytest
from PIL import Image
from django.contrib.auth import get_user_model
from apps.accounts.models import AccountProfile, OIDCIdentity
from apps.authorization.models import AuthorizationAuditEvent, Role, UserRoleAssignment
from .test_authorization import actor, seeded_role, grant, organization_tree

pytestmark=pytest.mark.django_db
URL="/api/v1/authorization/assignments/site-create-user/"


@pytest.fixture
def setup(actor,monkeypatch):
    from apps.sites.models import Site
    client,admin=actor
    root,owner=organization_tree()
    site=Site.objects.create(code="STAFF_A",name="Staff A",organization_unit=owner)
    other=Site.objects.create(code="STAFF_B",name="Staff B",organization_unit=root,is_main=True)
    grant(admin,seeded_role("site-administrator"),"SITE",owner,site)
    provider=Mock()
    provider.create.return_value=str(uuid4())
    monkeypatch.setattr("apps.accounts.site_provisioning.KeycloakAccounts",lambda:provider)
    values={"site":site.pk,"role":Role.objects.get(code="editor").pk,"username":"new.staff","email":"staff@example.edu","password":"Secure-Campus!5917","password_confirmation":"Secure-Campus!5917"}
    return client,admin,site,other,provider,values


def test_create_private_avatar_directory_and_identity_link(setup):
    client,admin,site,other,provider,values=setup
    picture=io.BytesIO();Image.new("RGB",(200,100),"red").save(picture,"PNG")
    values["profile_picture"]=base64.b64encode(picture.getvalue()).decode()
    response=client.post(URL,values,content_type="application/json")
    assert response.status_code==201,response.content
    user=get_user_model().objects.get(username="new.staff")
    assert not user.has_usable_password() and user.is_active and not user.is_staff and not user.is_superuser
    assert OIDCIdentity.objects.get(user=user).subject==provider.create.return_value
    profile=AccountProfile.objects.get(user=user)
    assert profile.state=="ACTIVE" and bytes(profile.picture).startswith(b"\xff\xd8")
    with Image.open(io.BytesIO(profile.picture)) as image:
        assert image.size==(128,128) and image.getexif()=={}
    assert list(user.role_assignments.values_list("site_id",flat=True))==[site.pk]
    directory=client.get(f"/api/v1/authorization/assignments/site-users/?site={site.pk}")
    row=next(row for row in directory.json()["results"] if row["user"]==user.pk)
    assert row["profile_picture"].startswith("data:image/jpeg;base64,")
    assert {"SITE_USER_CREATED","ROLE_ASSIGNED"} <= set(AuthorizationAuditEvent.objects.filter(actor=admin,site_id=str(site.pk),subject_user_id=str(user.pk),role_code="editor").values_list("action",flat=True))
    assert values["password"] not in str(list(AuthorizationAuditEvent.objects.values()))
    provider.enable.assert_called_once()


def test_create_without_picture_and_main_site_same_contract(setup):
    client,admin,site,other,provider,values=setup
    grant(admin,Role.objects.get(code="site-administrator"),"SITE",other.organization_unit,other)
    values["site"]=other.pk
    assert client.post(URL,values,content_type="application/json").status_code==201
    assert not AccountProfile.objects.get(user__username=values["username"]).picture


def test_platform_role_id_is_rejected(setup):
    client,admin,site,other,provider,values=setup
    values["role"]=Role.objects.get(code="platform-administrator").pk
    response=client.post(URL,values,content_type="application/json")
    assert response.status_code==400 and "role" in response.json()["error"]["details"]
    provider.create.assert_not_called()


def test_development_bootstrap_identity_cannot_be_created_by_site_admin(setup,settings):
    client,admin,site,other,provider,values=setup
    settings.DEV_PLATFORM_ADMIN_USERNAME="reserved-admin"
    values["username"]="RESERVED-ADMIN"
    response=client.post(URL,values,content_type="application/json")
    assert response.status_code==400 and "username" in response.json()["error"]["details"]
    provider.create.assert_not_called()


def test_provider_duplicate_has_no_local_assignment(setup):
    from rest_framework.exceptions import ValidationError
    client,admin,site,other,provider,values=setup
    provider.create.side_effect=ValidationError({"email":"This email already exists."})
    assert client.post(URL,values,content_type="application/json").status_code==400
    assert not get_user_model().objects.filter(username=values["username"]).exists()
    provider.enable.assert_not_called()


def test_resource_limit_and_animated_images_rejected(setup):
    client,admin,site,other,provider,values=setup
    image=io.BytesIO();Image.new("RGB",(2001,2000)).save(image,"PNG")
    values["profile_picture"]=base64.b64encode(image.getvalue()).decode()
    assert client.post(URL,values,content_type="application/json").status_code==400
    image=io.BytesIO();Image.new("RGB",(10,10),"red").save(image,"PNG",save_all=True,append_images=[Image.new("RGB",(10,10),"blue")])
    values["profile_picture"]=base64.b64encode(image.getvalue()).decode()
    assert client.post(URL,values,content_type="application/json").status_code==400
    provider.create.assert_not_called()


@pytest.mark.parametrize("change",[
    {"role":None},{"role":"platform"},{"email":"bad"},{"password_confirmation":"different"},
    {"password":"12345678","password_confirmation":"12345678"},{"username":"../bad"},
    {"profile_picture":base64.b64encode(b"<svg onload='bad'>").decode()},
    {"is_superuser":True},{"scope":"PLATFORM"},
])
def test_invalid_fields_have_no_provider_or_membership_side_effects(setup,change):
    client,admin,site,other,provider,values=setup
    values.update(change)
    before=UserRoleAssignment.objects.count()
    response=client.post(URL,values,content_type="application/json")
    assert response.status_code==400,response.content
    provider.create.assert_not_called()
    assert UserRoleAssignment.objects.count()==before


@pytest.mark.parametrize("field",["username","email"])
def test_local_duplicates_case_insensitive(setup,field):
    client,admin,site,other,provider,values=setup
    get_user_model().objects.create_user(username=values["username"].upper() if field=="username" else "existing",email=values["email"].upper() if field=="email" else "other@example.edu")
    response=client.post(URL,values,content_type="application/json")
    assert response.status_code==400,response.content
    assert field in response.json()["error"]["details"]
    provider.create.assert_not_called()


def test_foreign_site_denied_before_provider(setup):
    client,admin,site,other,provider,values=setup
    values["site"]=other.pk
    assert client.post(URL,values,content_type="application/json").status_code==403
    provider.create.assert_not_called()


@pytest.mark.parametrize("code",["viewer","editor"])
def test_unprivileged_role_denied(setup,code):
    client,admin,site,other,provider,values=setup
    UserRoleAssignment.objects.filter(user=admin).delete()
    grant(admin,Role.objects.get(code=code),"SITE",site.organization_unit,site)
    assert client.post(URL,values,content_type="application/json").status_code==403
    provider.create.assert_not_called()


def test_anonymous_denied(setup):
    client,admin,site,other,provider,values=setup
    client.defaults.clear()
    assert client.post(URL,values,content_type="application/json").status_code==401
    provider.create.assert_not_called()


def test_provider_failure_leaves_no_membership_and_records_outcome(setup):
    client,admin,site,other,provider,values=setup
    provider.enable.side_effect=TimeoutError()
    response=client.post(URL,values,content_type="application/json")
    assert response.status_code==503,response.content
    assert not get_user_model().objects.filter(username=values["username"]).exists()
    provider.remove.assert_called_once_with(provider.create.return_value)
    assert AuthorizationAuditEvent.objects.filter(action="SITE_USER_CREATED",outcome="DENY",site_id=str(site.pk)).exists()


def test_failed_remote_cleanup_retains_blocked_identity_without_assignment(setup):
    client,admin,site,other,provider,values=setup
    provider.enable.side_effect=TimeoutError()
    provider.remove.side_effect=TimeoutError()
    assert client.post(URL,values,content_type="application/json").status_code==503
    user=get_user_model().objects.get(username=values["username"])
    assert not user.is_active and user.account_profile.state=="FAILED"
    assert not user.role_assignments.exists()
    # Token synchronization must never reactivate this tombstone.
    from apps.accounts.provisioning import provision_user,AccountLinkError
    from types import SimpleNamespace
    identity=user.oidc_identity
    with pytest.raises(AccountLinkError):
        provision_user(SimpleNamespace(issuer=identity.issuer,subject=identity.subject))


def test_recovery_cleans_failed_accounts_and_preserves_active_accounts(setup):
    from django.core.management import call_command
    client,admin,site,other,provider,values=setup
    assert client.post(URL,values,content_type="application/json").status_code==201
    active=get_user_model().objects.get(username=values["username"])
    provider.create.return_value=str(uuid4())
    provider.enable.side_effect=TimeoutError()
    provider.remove.side_effect=TimeoutError()
    values.update(username="failed.staff",email="failed@example.edu")
    assert client.post(URL,values,content_type="application/json").status_code==503
    provider.remove.side_effect=None
    provider.remove.reset_mock()
    call_command("reconcile_site_accounts",apply=True,minimum_age_minutes=0)
    assert not get_user_model().objects.filter(username="failed.staff").exists()
    assert get_user_model().objects.get(pk=active.pk).is_active
    assert active.account_profile.state=="ACTIVE"
    provider.remove.assert_called_once_with(provider.create.return_value)
