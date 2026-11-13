"""Local-only archive rehearsal; no credentials, generated users disabled."""
import json
from uuid import uuid4
from django.conf import settings
from django.contrib.auth import get_user_model
from apps.api.models import Category, Post
from apps.cms.tests.support import transition_with_site_role

assert settings.DEBUG
run = uuid4().hex[:10]
users = [get_user_model().objects.create_user(username=f"archive-{run}-{role}") for role in ("author","reviewer","publisher")]

def publish(content):
    for action,user in zip(("submit","approve","publish"),users):
        transition_with_site_role(content,action,user)
    content.refresh_from_db()
    return content

try:
    # Reuse the two host-scoped news rehearsal Sites; fail rather than guess.
    from apps.sites.models import SiteDomain
    own=SiteDomain.objects.get(hostname="article-media-post-14a6169c2f.uog.local").site
    other=SiteDomain.objects.get(hostname="news-central-post-14a6169c2f.uog.local").site
    category=publish(Category.objects.create(site=own,code=f"ARCHIVE_{run.upper()}",name=f"Research {run}"))
    empty=publish(Category.objects.create(site=own,code=f"EMPTY_{run.upper()}",name=f"Empty {run}"))
    foreign=publish(Category.objects.create(site=other,code=f"FOREIGN_{run.upper()}",name=f"Foreign {run}"))
    private=Category.objects.create(site=own,code=f"PRIVATE_{run.upper()}",name=f"Private {run}")
    for number in range(5):
        post=Post.objects.create(site=own,title=f"Research update {number}",slug=f"research-{run}-{number}",excerpt="Approved university research",content="<p>Published research.</p>")
        post.categories.add(category)
        publish(post)
    post=Post.objects.create(site=own,title="Private archive draft",slug=f"private-{run}",content="PRIVATE ARCHIVE MARKER")
    post.categories.add(category)
    print(json.dumps({"run":run,"host":"article-media-post-14a6169c2f.uog.local","category":category.slug,"name":category.name,"empty":empty.slug,"foreign":foreign.slug,"private":private.slug,"generated_accounts_disabled":len(users)}))
finally:
    get_user_model().objects.filter(pk__in=[user.pk for user in users]).update(is_active=False)
