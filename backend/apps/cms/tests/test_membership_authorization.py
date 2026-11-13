"""Site Users memberships must authorize CMS without duplicate legacy grants."""
from datetime import timedelta
import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.utils import timezone
from apps.authorization.models import Role,UserRoleAssignment
from apps.cms.authorization import cms_grant_allows
from apps.cms.models import ContentRole,SiteContentRoleAssignment
from .test_realm_role_authorization import _enable,_identity,PAGES,POSTS,WORKFLOW

pytestmark=pytest.mark.django_db


@pytest.mark.parametrize("code,allowed",[
    ("site-administrator",{"AUTHOR","REVIEWER","PUBLISHER"}),
    ("editor",{"AUTHOR"}),("reviewer",{"REVIEWER"}),
    ("publisher",{"PUBLISHER"}),("viewer",set()),
])
def test_membership_reads_and_workflow_roles_are_scoped_and_live(client,oidc,sites,code,allowed):
    call_command("seed_rbac",verbosity=0)
    own,other=sites
    _enable("PAGES",own,other);_enable("POSTS",own,other)
    header=_identity(oidc,"membership-"+code,roles=["platform-admin"])
    assert client.get("/api/me/",**header).status_code==200
    user=get_user_model().objects.get(username="membership-"+code)
    assignment=UserRoleAssignment.objects.create(user=user,role=Role.objects.get(code=code),scope="SITE",site=own,organization=own.organization_unit)
    assert not SiteContentRoleAssignment.objects.filter(user=user).exists()
    for path in [PAGES,POSTS]:
        assert client.get(path.format(site=own.pk),**header).status_code==200
        assert client.get(path.format(site=other.pk),**header).status_code==403
    for role in ContentRole.values:
        assert cms_grant_allows(user,own.pk,[role]) == (role in allowed)
        assert not cms_grant_allows(user,other.pk,[role])
    created=client.post(POSTS.format(site=own.pk),{"title":"Scoped article","slug":"scoped-article","content":"<p>Draft</p>"},content_type="application/json",**header)
    assert created.status_code==(201 if "AUTHOR" in allowed else 403),created.content
    assignment.expires_at=timezone.now()-timedelta(seconds=1);assignment.save()
    assert not cms_grant_allows(user,own.pk,ContentRole.values)
    assignment.expires_at=None;assignment.revoked_at=timezone.now();assignment.save()
    assert not cms_grant_allows(user,own.pk,ContentRole.values)
    assert client.get(POSTS.format(site=own.pk),**header).status_code==403


def test_role_deactivation_closes_membership_cms_access(client,oidc,sites):
    call_command("seed_rbac",verbosity=0)
    user=get_user_model().objects.create_user(username="disabled-role-member")
    role=Role.objects.get(code="publisher")
    UserRoleAssignment.objects.create(user=user,role=role,scope="SITE",site=sites[0],organization=sites[0].organization_unit)
    assert cms_grant_allows(user,sites[0].pk,[ContentRole.PUBLISHER])
    role.is_active=False;role.save()
    assert not cms_grant_allows(user,sites[0].pk,[ContentRole.PUBLISHER])


def test_membership_only_editor_reviewer_publisher_handoff(client,oidc,sites):
    call_command("seed_rbac",verbosity=0)
    site=sites[0];_enable("POSTS",site)
    headers={}
    for code in ["editor","reviewer","publisher"]:
        header=_identity(oidc,"handoff-"+code,roles=[])
        assert client.get("/api/me/",**header).status_code==200
        user=get_user_model().objects.get(username="handoff-"+code)
        UserRoleAssignment.objects.create(user=user,role=Role.objects.get(code=code),scope="SITE",site=site,organization=site.organization_unit)
        headers[code]=header
    created=client.post(POSTS.format(site=site.pk),{"title":"Membership workflow","slug":"membership-workflow","content":"<p>Approved news</p>"},content_type="application/json",**headers["editor"])
    assert created.status_code==201,created.content
    workflow=WORKFLOW.format(site=site.pk,content=created.json()["id"])
    for code,action in [("editor","submit"),("reviewer","approve"),("publisher","publish"),("publisher","unpublish")]:
        response=client.post(workflow,{"action":action,"comment":"Reviewed membership regression"},content_type="application/json",**headers[code])
        assert response.status_code==200,response.content
    assert not SiteContentRoleAssignment.objects.filter(site=site,user__username__startswith="handoff-").exists()
