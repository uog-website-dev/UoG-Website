"""Host-scoped published category archives and stable shared pagination."""
from datetime import timedelta
import pytest
from django.utils import timezone
from apps.api.models import Category, Post
from apps.sites.models import Module
from apps.sites.services.modules import disable_module_for_site
from .test_public_posts import _host, _publish

pytestmark = pytest.mark.django_db
BASE = "/api/v1/site-context/posts/categories/"


def test_archive_scope_order_empty_and_category_eligibility(client,sites,posts_module,monkeypatch):
    site,other = sites
    host = _host(site)
    category = _publish(Category.objects.create(site=site,code="SCIENCE",name="Science"))
    empty = _publish(Category.objects.create(site=site,code="EMPTY",name="Empty"))
    foreign = _publish(Category.objects.create(site=other,code="FOREIGN",name="Foreign"))
    private = Category.objects.create(site=site,code="PRIVATE",name="Private")
    same_slug = _publish(Category.objects.create(site=other,code="SCIENCE",name="Science"))
    foreign_post = Post.objects.create(site=other,title="Foreign science",slug="foreign-science",content="FOREIGN SECRET")
    foreign_post.categories.add(same_slug)
    _publish(foreign_post)
    stamp = timezone.now()-timedelta(hours=1)
    articles=[]
    with monkeypatch.context() as patch:
        patch.setattr("django.utils.timezone.now",lambda:stamp)
        for n in range(5):
            post=Post.objects.create(site=site,title=f"Article {n}",slug=f"article-{n}",content="Published")
            post.categories.add(category,empty)
            articles.append(_publish(post))
    draft=Post.objects.create(site=site,title="Secret draft",slug="secret-draft",content="SECRET")
    draft.categories.add(category)
    future=timezone.now()+timedelta(days=2)
    with monkeypatch.context() as patch:
        patch.setattr("django.utils.timezone.now",lambda:future)
        future_category = _publish(Category.objects.create(site=site,code="FUTURE",name="Future"))
        post=Post.objects.create(site=site,title="Future secret",slug="future-secret",content="FUTURE")
        post.categories.add(category)
        _publish(post)
    actual=[]
    for page in range(1,4):
        result=client.get(BASE+category.slug+f"/?page={page}&page_size=2",HTTP_HOST=host)
        assert result.status_code==200,result.content
        body=result.json()
        assert body["category"]["name"]=="Science" and body["count"]==5
        actual.extend(row["id"] for row in body["results"])
    assert actual==sorted([str(post.pk) for post in articles],reverse=True)
    assert len(set(actual))==5
    for slug in [foreign.slug,private.slug,future_category.slug,"unknown"]:
        assert client.get(BASE+slug+"/",HTTP_HOST=host).status_code==404
    unused=_publish(Category.objects.create(site=site,code="UNUSED",name="Unused"))
    assert client.get(BASE+unused.slug+"/",HTTP_HOST=host).json()["results"]==[]
    # Warm the feed cache before changing taxonomy eligibility.
    assert client.get("/api/v1/site-context/posts/",HTTP_HOST=host).status_code==200
    category.is_active=False
    category.save()
    assert client.get(BASE+category.slug+"/",HTTP_HOST=host).status_code==404
    feed=client.get("/api/v1/site-context/posts/",HTTP_HOST=host).json()
    assert all(category.slug not in [t["slug"] for t in row["categories"]] for row in feed["results"])
    disable_module_for_site(site.pk,Module.objects.get(code="POSTS").pk)
    assert client.get(BASE+empty.slug+"/",HTTP_HOST=host).status_code==404


@pytest.mark.parametrize("query",["page=0","page=-1","page=bad","page_size=0","page_size=101","page_size=1&page_size=2","category=other","site_id=99","tag=<script>"])
def test_archive_rejects_invalid_query(client,sites,posts_module,query):
    host=_host(sites[0])
    category=_publish(Category.objects.create(site=sites[0],code="NEWS",name="News"))
    response=client.get(BASE+category.slug+"/?"+query,HTTP_HOST=host)
    assert response.status_code==400,response.content
