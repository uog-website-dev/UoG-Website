"""Published news eligibility, snapshot ordering and host-bound pagination."""
from datetime import timedelta
import pytest
from django.utils import timezone
from apps.api.models import Post
from apps.cms.models import PublishedContentSnapshot
from apps.cms.selectors.posts import published_posts
from apps.cms.tests.support import transition_with_site_role
from .test_public_posts import _publish, _host, _new_user, PUBLIC_POSTS

pytestmark = pytest.mark.django_db


def test_equal_publication_times_have_stable_pages_and_share_widget_order(client,sites,posts_module,monkeypatch):
    site, other = sites
    host, foreign_host = _host(site), _host(other)
    stamp = timezone.now()-timedelta(hours=1)
    with monkeypatch.context() as patch:
        patch.setattr("django.utils.timezone.now",lambda:stamp)
        articles = [_publish(Post.objects.create(site=site,title=f"News {n}",slug=f"news-{n}",content="Published news",excerpt="A campus update")) for n in range(5)]
        _publish(Post.objects.create(site=other,title="Foreign news",slug="foreign-news",content="Foreign marker"))
    expected = sorted((str(post.pk) for post in articles),reverse=True)
    actual = []
    for number in range(1,4):
        response = client.get(PUBLIC_POSTS+f"?page={number}&page_size=2",HTTP_HOST=host)
        assert response.status_code == 200,response.content
        assert response.json()["count"] == 5
        actual.extend(row["id"] for row in response.json()["results"])
    assert actual == expected and len(set(actual)) == 5
    assert [str(post.pk) for post in published_posts(site.pk,articles[0].locale)] == expected
    widgets = client.get("/api/v1/site-context/widgets/?source=posts&limit=5",HTTP_HOST=host)
    assert widgets.status_code == 200,widgets.content
    assert [row["id"] for row in widgets.json()["results"]] == expected
    assert client.get(PUBLIC_POSTS,HTTP_HOST=foreign_host).json()["count"] == 1


@pytest.mark.parametrize("query",["page_size=0","page_size=-1","page_size=101","page_size=abc","page_size=1.5","page_size=","page=0","page=-1","page=abc","page_size=2&page_size=3","site=999","site_id=999"])
def test_invalid_or_foreign_scope_queries_are_rejected(client,sites,posts_module,query):
    host = _host(sites[0])
    response = client.get(PUBLIC_POSTS+"?"+query,HTTP_HOST=host)
    assert response.status_code == 400,response.content
    assert response.json()["error"]["details"]


def test_future_drafts_unpublished_and_unsnapshotted_posts_are_excluded(client,sites,posts_module,monkeypatch):
    site = sites[0]
    host = _host(site)
    visible = _publish(Post.objects.create(site=site,title="Visible",slug="visible-news",content="Public body"))
    Post.objects.create(site=site,title="Draft marker",slug="draft-marker",content="PRIVATE MARKER")
    future = timezone.now()+timedelta(days=1)
    with monkeypatch.context() as patch:
        patch.setattr("django.utils.timezone.now",lambda:future)
        deferred = _publish(Post.objects.create(site=site,title="Future marker",slug="future-marker",content="FUTURE MARKER"))
    removed = _publish(Post.objects.create(site=site,title="Unpublished marker",slug="removed-marker",content="REMOVED MARKER"))
    transition_with_site_role(removed,"unpublish",_new_user("news-unpublisher"))
    response = client.get(PUBLIC_POSTS,HTTP_HOST=host)
    assert [row["id"] for row in response.json()["results"]] == [str(visible.pk)]
    assert all(marker not in response.content.decode() for marker in ["PRIVATE MARKER","FUTURE MARKER","REMOVED MARKER","editor_document","review_comment","created_by"])
    assert client.get(PUBLIC_POSTS+deferred.slug+"/",HTTP_HOST=host).status_code == 404


def test_empty_default_maximum_and_disabled_news_contract(client,sites,posts_module):
    from apps.sites.models import Module
    from apps.sites.services.modules import disable_module_for_site
    host = _host(sites[0])
    for suffix in ["","?page_size=100"]:
        response = client.get(PUBLIC_POSTS+suffix,HTTP_HOST=host)
        assert response.status_code == 200
        assert response.json() == {"count":0,"next":None,"previous":None,"results":[]}
    disable_module_for_site(sites[0].pk,Module.objects.get(code="POSTS").pk)
    assert client.get(PUBLIC_POSTS,HTTP_HOST=host).status_code == 404


def test_republished_article_orders_by_current_snapshot_time(client,sites,posts_module,monkeypatch):
    from apps.api.post_drafts import open_post_draft
    from apps.cms.models import ContentRole,SiteContentRoleAssignment
    from apps.cms.services.working_drafts import content_etag
    site = sites[0]
    host = _host(site)
    now = timezone.now()
    with monkeypatch.context() as patch:
        patch.setattr("django.utils.timezone.now",lambda:now-timedelta(hours=2))
        original = _publish(Post.objects.create(site=site,title="Older article",slug="older-article",content="Original body"))
    with monkeypatch.context() as patch:
        patch.setattr("django.utils.timezone.now",lambda:now-timedelta(hours=1))
        other = _publish(Post.objects.create(site=site,title="Recent article",slug="recent-article",content="Recent body"))
    actor = _new_user("news-working-author")
    SiteContentRoleAssignment.objects.create(site=site,user=actor,role=ContentRole.AUTHOR)
    draft,_created = open_post_draft(site_id=site.pk,post_id=original.pk,actor=actor,if_match=content_etag(original))
    draft.title = "Updated article"
    draft.save()
    _publish(draft)
    response = client.get(PUBLIC_POSTS,HTTP_HOST=host)
    assert [row["id"] for row in response.json()["results"]] == [str(original.pk),str(other.pk)]
    latest = PublishedContentSnapshot.objects.filter(content=original).order_by("-version").first()
    assert response.json()["results"][0]["publication_version"] == latest.version
    original.refresh_from_db()
    assert original.published_at < other.published_at


def test_main_property_and_child_use_the_same_host_scoped_news_contract(client,sites,posts_module):
    from apps.sites.models import Site,Module
    from apps.sites.services.modules import enable_module_for_site
    main = Site.objects.create(organization_unit=sites[0].organization_unit.parent,code="MAIN_NEWS_PUBLIC",name="Main University Site",is_main=True)
    enable_module_for_site(main.pk,Module.objects.get(code="POSTS").pk)
    main_host,child_host = _host(main),_host(sites[0])
    main_post = _publish(Post.objects.create(site=main,title="Main news",slug="shared-news",content="Main publication"))
    child_post = _publish(Post.objects.create(site=sites[0],title="Child news",slug="shared-news",content="Child publication"))
    for host,post in [(main_host,main_post),(child_host,child_post)]:
        response = client.get(PUBLIC_POSTS,HTTP_HOST=host)
        assert response.status_code == 200,response.content
        assert [row["id"] for row in response.json()["results"]] == [str(post.pk)]
        assert response.json()["results"][0]["site"] == post.site_id
