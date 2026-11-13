"""Host-scoped, publication-eligible article selection for feeds and widgets."""
from django.db.models import OuterRef, Subquery
from django.utils import timezone
from apps.api.models import Post
from ..models import ContentStatus, PublishedContentSnapshot


def published_posts(site_id, locale, *, category=None, tag=None):
    now = timezone.now()
    latest = PublishedContentSnapshot.objects.filter(content_id=OuterRef("pk")).order_by("-version")
    posts = Post.objects.filter(
        site_id=site_id, locale=locale, status=ContentStatus.PUBLISHED,
        draft_of__isnull=True, published_at__lte=now,
    ).annotate(serving_published_at=Subquery(latest.values("published_at")[:1])).filter(serving_published_at__lte=now)
    for value, relation in ((category,"categories"),(tag,"tags")):
        if value:
            posts = posts.filter(**{
                f"{relation}__site_id":site_id, f"{relation}__locale":locale,
                f"{relation}__is_active":True, f"{relation}__slug":value,
            })
    return posts.distinct().order_by("-serving_published_at","-pk")
