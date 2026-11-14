"""Page shell choices preserve builder bodies, revisions and public snapshots."""
import copy
import pytest
from django.core.management import call_command
from django.contrib.auth import get_user_model
from apps.authorization.models import Role,UserRoleAssignment
from apps.cms.models import Page,PublishedContentSnapshot
from apps.cms.services.working_drafts import content_etag,open_working_draft
from apps.cms.tests.support import transition_with_site_role
from .test_realm_role_authorization import _identity,_enable,PAGES
from .test_public_posts import _host

pytestmark=pytest.mark.django_db
TREE={"schema_version":1,"rows":[{"id":"row","type":"section","ratios":[60,40],"columns":[{"id":"left","type":"column","children":[{"id":"headline","type":"headline","props":{"text":"Retained builder content","level":2}}]},{"id":"right","type":"column","children":[]}]}]}


@pytest.fixture
def world(client,oidc,sites):
    call_command("seed_rbac",verbosity=0)
    _enable("PAGES",*sites);_enable("VISUAL_BUILDER",*sites)
    users={};headers={}
    for code in ["editor","reviewer","publisher"]:
        header=_identity(oidc,"shell-"+code,roles=[])
        assert client.get("/api/me/",**header).status_code==200
        user=get_user_model().objects.get(username="shell-"+code)
        UserRoleAssignment.objects.create(user=user,role=Role.objects.get(code=code),scope="SITE",site=sites[0],organization=sites[0].organization_unit)
        users[code]=user;headers[code]=header
    return sites,users,headers


@pytest.mark.parametrize("layout",["FULL_WIDTH","LEFT_SIDEBAR","RIGHT_SIDEBAR"])
def test_layout_roundtrip_keeps_complete_builder_tree(client,world,layout):
    sites,users,headers=world;site=sites[0]
    created=client.post(PAGES.format(site=site.pk),{"title":"Layout page","slug":"layout-page","metadata":{"visual_layout":TREE},"layout":"FULL_WIDTH"},content_type="application/json",**headers["editor"])
    assert created.status_code==201,created.content
    page=Page.objects.get(pk=created.json()["id"])
    original=copy.deepcopy(page.metadata);old_revision=page.revision_number
    response=client.patch(PAGES.format(site=site.pk)+str(page.pk)+"/",{"layout":layout},content_type="application/json",HTTP_IF_MATCH=content_etag(page),**headers["editor"])
    assert response.status_code==200,response.content
    page.refresh_from_db()
    assert page.layout==layout and page.metadata==original and page.blocks==[]
    assert page.revisions.filter(revision_number=old_revision).exists()
    assert page.revisions.order_by('-revision_number').first().snapshot["layout"]==layout


@pytest.mark.parametrize("value",["UNKNOWN","../../template.html","<script>","left-sidebar"])
def test_unknown_layout_does_not_persist(client,world,value):
    sites,users,headers=world
    before=Page.objects.count()
    response=client.post(PAGES.format(site=sites[0].pk),{"title":"Invalid","slug":"invalid","layout":value},content_type="application/json",**headers["editor"])
    assert response.status_code==400 and "layout" in response.json()["error"]["details"]
    assert Page.objects.count()==before


def test_draft_layout_is_private_until_reviewed_publication(client,world):
    sites,users,headers=world;site=sites[0];host=_host(site)
    page=Page(site=site,title="Published layout",slug="published-layout",layout="FULL_WIDTH",metadata={"visual_layout":TREE},created_by=users["editor"],updated_by=users["editor"]);page.save()
    for action,role in [("submit","editor"),("approve","reviewer"),("publish","publisher")]:transition_with_site_role(page,action,users[role]);page.refresh_from_db()
    snapshot=PublishedContentSnapshot.objects.get(content=page).payload
    draft,_=open_working_draft(page,actor=users["editor"])
    response=client.patch(PAGES.format(site=site.pk)+str(draft.pk)+"/",{"layout":"LEFT_SIDEBAR"},content_type="application/json",HTTP_IF_MATCH=content_etag(draft),**headers["editor"])
    assert response.status_code==200,response.content
    assert client.get('/api/v1/site-context/pages/published-layout/',HTTP_HOST=host).json()["layout"]=="FULL_WIDTH"
    assert PublishedContentSnapshot.objects.get(content=page).payload==snapshot
    draft.refresh_from_db();assert draft.metadata==page.metadata
    for action,role in [("submit","editor"),("approve","reviewer"),("publish","publisher")]:transition_with_site_role(draft,action,users[role]);draft.refresh_from_db()
    assert client.get('/api/v1/site-context/pages/published-layout/',HTTP_HOST=host).json()["layout"]=="LEFT_SIDEBAR"


def test_permissions_site_and_module_gates_precede_layout_changes(client,world):
    from apps.sites.models import Module
    from apps.sites.services.modules import disable_module_for_site
    sites,users,headers=world;site,other=sites
    page=Page(site=site,title="Protected",slug="protected",created_by=users['editor']);page.save()
    url=PAGES.format(site=site.pk)+str(page.pk)+'/'
    for role in ['reviewer','publisher']:
        response=client.patch(url,{"layout":"RIGHT_SIDEBAR"},content_type='application/json',HTTP_IF_MATCH=content_etag(page),**headers[role])
        assert response.status_code==403
    response=client.patch(url.replace(f'/{site.pk}/',f'/{other.pk}/'),{"layout":"RIGHT_SIDEBAR"},content_type='application/json',HTTP_IF_MATCH=content_etag(page),**headers['editor'])
    assert response.status_code in [403,404]
    disable_module_for_site(site.pk,Module.objects.get(code='VISUAL_BUILDER').pk)
    disable_module_for_site(site.pk,Module.objects.get(code='PAGES').pk)
    response=client.patch(url,{"layout":"RIGHT_SIDEBAR"},content_type='application/json',HTTP_IF_MATCH=content_etag(page),**headers['editor'])
    assert response.status_code==400
    assert response.json()["error"]["details"]["reason"]=="module_disabled"
    page.refresh_from_db();assert page.layout==''
