"""Seed two-Site published/draft SEO records for rendered-head QA."""
import json
import uuid

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from apps.api.models import Post
from apps.cms.models import Page
from apps.cms.tests.support import transition_with_site_role
from apps.sites.models import Site

run = uuid.uuid4().hex[:10]
site_a = Site.objects.get(code="HOMETPL-E993407F76A")
site_b = Site.objects.get(code="HOMETPL-E993407F76B")
users = [get_user_model().objects.create_user(username=f"seoaccept-{run}-{role}") for role in ("author", "reviewer", "publisher")]

def publish(content):
    for action, actor in zip(("submit", "approve", "publish"), users):
        transition_with_site_role(content, action, actor)

page_a = Page.objects.create(
    site=site_a, title=f"SEO public page {run}", slug=f"seo-public-{run}",
    seo={"meta_title": f"Explicit SEO title {run}"}, created_by=users[0],
)
publish(page_a)
page_b = Page.objects.create(
    site=site_b, title=f"Foreign Site page {run}", slug=f"seo-foreign-{run}",
    seo={"meta_title": f"Foreign title must not leak {run}"}, created_by=users[0],
)
publish(page_b)
draft = Page.objects.create(
    site=site_a, title=f"Secret draft title {run}", slug=f"seo-draft-{run}",
    seo={"meta_title": f"Secret draft SEO {run}", "meta_description": f"Secret draft description {run}"}, created_by=users[0],
)
post = Post.objects.create(
    site=site_a, title=f"SEO fallback post {run}", slug=f"seo-post-{run}",
    excerpt=f"Published excerpt fallback {run}", content="Public QA content", seo={}, created_by=users[0],
)
publish(post)

unsafe_rejected = False
try:
    Page.objects.create(
        site=site_a, title=f"Unsafe validation {run}", slug=f"seo-unsafe-{run}",
        seo={"meta_title": f"<script>alert('{run}')</script>"}, created_by=users[0],
    )
except ValidationError:
    unsafe_rejected = True

print(json.dumps({
    "run": run, "host_a": "hometpl-e993407f76a.uog.local", "host_b": "hometpl-e993407f76b.uog.local",
    "page_path": page_a.path, "page_title": f"Explicit SEO title {run}",
    "foreign_path": page_b.path, "foreign_title": f"Foreign title must not leak {run}",
    "draft_path": draft.path, "draft_secret": f"Secret draft SEO {run}",
    "post_slug": post.slug, "post_excerpt": post.excerpt, "unsafe_rejected": unsafe_rejected,
}))
