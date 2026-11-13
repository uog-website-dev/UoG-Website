"""Review and publish Post working copies while the approved article stays live."""
import pytest
from django.contrib.auth import get_user_model
from apps.api.models import Post
from apps.cms.models import PublishedContentSnapshot, ContentStatus, ContentRole, SiteContentRoleAssignment
from apps.cms.services.working_drafts import content_etag
from .test_posts_api import author, site_editor, _enable_posts_module, POSTS
from .test_public_posts import _publish, _host

pytestmark = pytest.mark.django_db


def test_post_working_draft_preserves_publication_until_reviewed_promotion(site_editor, author, sites, client, oidc):
    site = sites[0]
    _enable_posts_module(*sites)
    host = _host(site)
    original = Post.objects.create(site=site,title="Approved article",slug="approved-article",content="Approved body",created_by=author,updated_by=author)
    _publish(original)
    original.refresh_from_db()
    public = "/api/v1/site-context/posts/approved-article/"
    before = client.get(public,HTTP_HOST=host).json()
    url = POSTS.format(site=site.pk)+f"{original.pk}/working-draft/"
    response = site_editor.post(url,content_type="application/json",HTTP_IF_MATCH=content_etag(original))
    assert response.status_code == 201,response.content
    draft = response.json()
    assert draft["draft_of"] == str(original.pk)
    assert draft["publication_slug"] == "approved-article"
    assert site_editor.post(url,content_type="application/json",HTTP_IF_MATCH=content_etag(original)).json()["id"] == draft["id"]
    detail = POSTS.format(site=site.pk)+draft["id"]+"/"
    saved = site_editor.patch(detail,{"title":"Revised article","editor_document":{"schema_version":1,"html":"<h2>Revised report</h2><p>Private revised body</p>"}},content_type="application/json",HTTP_IF_MATCH=response["ETag"])
    assert saved.status_code == 200,saved.content
    assert client.get(public,HTTP_HOST=host).json() == before
    preview = site_editor.get(detail+"preview/")
    assert preview.status_code == 200 and preview["Cache-Control"] == "private, no-store"
    assert "Private revised body" in preview.json()["editor_document"]["html"]
    from django.test import Client
    assert Client().get(detail+"preview/").status_code == 401
    workflow = f"/api/v1/cms/sites/{site.pk}/content/{draft['id']}/workflow/"
    submitted = site_editor.post(workflow,{"action":"submit"},content_type="application/json",HTTP_IF_MATCH=saved["ETag"])
    assert submitted.status_code == 200 and submitted.json()["status"] == "IN_REVIEW",submitted.content
    assert client.get(public,HTTP_HOST=host).json() == before
    assert site_editor.post(workflow,{"action":"publish"},content_type="application/json").status_code == 403
    reviewer = get_user_model().objects.create_user(username="working-reviewer")
    publisher = get_user_model().objects.create_user(username="working-publisher")
    for user,role in [(reviewer,ContentRole.REVIEWER),(publisher,ContentRole.PUBLISHER)]:
        SiteContentRoleAssignment.objects.create(user=user,site=site,role=role)
    def auth(user):
        return oidc.header(sub=str(user.pk),preferred_username=user.username,email=f"{user.username}@example.test")
    stale = client.post(workflow,{"action":"approve"},content_type="application/json",HTTP_IF_MATCH=saved["ETag"],**auth(reviewer))
    assert stale.status_code == 409
    approved = client.post(workflow,{"action":"approve","comment":"Approved after checking the private preview."},content_type="application/json",HTTP_IF_MATCH=submitted["ETag"],**auth(reviewer))
    assert approved.status_code == 200,approved.content
    assert site_editor.patch(detail,{"title":"Unreviewed mutation"},content_type="application/json",HTTP_IF_MATCH=approved["ETag"]).status_code == 400
    published = client.post(workflow,{"action":"publish"},content_type="application/json",HTTP_IF_MATCH=approved["ETag"],**auth(publisher))
    assert published.status_code == 200,published.content
    assert published.json()["status"] == "ARCHIVED"
    original.refresh_from_db()
    assert original.reviewed_by_id == reviewer.pk
    assert original.review_comment == "Approved after checking the private preview."
    after = client.get(public,HTTP_HOST=host).json()
    assert after["id"] == str(original.pk) and after["title"] == "Revised article"
    assert after["slug"] == "approved-article" and "Private revised body" in after["content"]
    assert PublishedContentSnapshot.objects.filter(content=original).count() == 2
    assert PublishedContentSnapshot.objects.filter(content=original,version=1).get().payload["content"] == "Approved body"


def test_preview_working_copy_and_review_are_scoped_and_module_gated(site_editor, author, sites, client):
    from apps.sites.models import Module
    from apps.sites.services.modules import disable_module_for_site
    site, foreign = sites
    _enable_posts_module(*sites)
    own = Post.objects.create(site=site,title="Own article",slug="own-article",content="Own body")
    other = Post.objects.create(site=foreign,title="Foreign article",slug="foreign-article",content="Secret")
    base = POSTS.format(site=site.pk)
    assert site_editor.get(base+f"{other.pk}/preview/").status_code == 404
    assert site_editor.post(base+f"{other.pk}/working-draft/",HTTP_IF_MATCH=content_etag(other)).status_code == 404
    workflow = f"/api/v1/cms/sites/{site.pk}/content/{other.pk}/workflow/"
    assert site_editor.post(workflow,{"action":"approve"},content_type="application/json").status_code == 404
    ownflow = f"/api/v1/cms/sites/{site.pk}/content/{own.pk}/workflow/"
    assert site_editor.post(ownflow,{"action":"approve"},content_type="application/json").status_code == 403
    disable_module_for_site(site.pk,Module.objects.get(code="POSTS").pk)
    assert site_editor.get(base+f"{own.pk}/preview/").status_code == 400
    assert site_editor.post(base+f"{own.pk}/working-draft/",HTTP_IF_MATCH=content_etag(own)).status_code == 400
    assert site_editor.post(ownflow,{"action":"submit"},content_type="application/json").status_code == 400


def test_reviewer_comments_invalid_states_and_foreign_site_denial(site_editor, author, sites, client, oidc):
    from apps.cms.models import ContentWorkflowTransition
    site, foreign = sites
    _enable_posts_module(*sites)
    article = Post.objects.create(site=site,title="Review article",slug="review-article",content="Review body",created_by=author,updated_by=author)
    other = Post.objects.create(site=foreign,title="Foreign review",slug="foreign-review",content="Foreign body")
    reviewer = get_user_model().objects.create_user(username="scoped-reviewer")
    SiteContentRoleAssignment.objects.create(user=reviewer,site=site,role=ContentRole.REVIEWER)
    headers = oidc.header(sub=str(reviewer.pk),preferred_username=reviewer.username,email="scoped-reviewer@example.test")
    flow = f"/api/v1/cms/sites/{site.pk}/content/{article.pk}/workflow/"
    invalid = client.post(flow,{"action":"approve"},content_type="application/json",**headers)
    assert invalid.status_code == 409
    article.refresh_from_db()
    assert article.status == "DRAFT" and not ContentWorkflowTransition.objects.filter(content=article).exists()
    assert site_editor.post(flow,{"action":"submit"},content_type="application/json").status_code == 200
    missing = client.post(flow,{"action":"reject"},content_type="application/json",**headers)
    assert missing.status_code == 400
    rejected = client.post(flow,{"action":"reject","comment":"Please verify the research figures."},content_type="application/json",**headers)
    assert rejected.status_code == 200,rejected.content
    assert rejected.json()["status"] == "DRAFT" and rejected.json()["review_comment"] == "Please verify the research figures."
    foreign_flow = f"/api/v1/cms/sites/{foreign.pk}/content/{other.pk}/workflow/"
    assert client.post(foreign_flow,{"action":"approve"},content_type="application/json",**headers).status_code == 403
    article.refresh_from_db()
    snapshot = (article.content,article.status,article.revision_number)
    forged = site_editor.patch(POSTS.format(site=site.pk)+f"{article.pk}/",{"draft_of":str(other.pk)},content_type="application/json",HTTP_IF_MATCH=content_etag(article))
    assert forged.status_code == 400
    article.refresh_from_db()
    assert (article.content,article.status,article.revision_number) == snapshot


@pytest.mark.parametrize("role_code",["reviewer","publisher"])
def test_standard_review_roles_have_scoped_workspace_and_media_reads(sites,role_code):
    from django.core.management import call_command
    from rest_framework.test import APIClient
    from apps.authorization.models import Role, UserRoleAssignment
    from apps.authorization.services import permission_granted
    call_command("seed_rbac",verbosity=0)
    user = get_user_model().objects.create_user(username="workspace-"+role_code)
    UserRoleAssignment.objects.create(user=user,role=Role.objects.get(code=role_code),scope="SITE",site=sites[0],organization=sites[0].organization_unit)
    api = APIClient()
    api.force_authenticate(user)
    response = api.get("/api/v1/sites/")
    assert response.status_code == 200,response.content
    assert [row["id"] for row in response.json()["results"]] == [sites[0].pk]
    assert permission_granted(user,"content.media.view",site_id=sites[0].pk)
    assert not permission_granted(user,"content.media.upload",site_id=sites[0].pk)
    assert not permission_granted(user,"content.posts.update",site_id=sites[0].pk)
    assert not permission_granted(user,"sites.view",site_id=sites[1].pk)
    assert not permission_granted(user,"content.media.view",site_id=sites[1].pk)
