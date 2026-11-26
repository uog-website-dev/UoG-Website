"""Shared menu destination eligibility. Never return private target metadata."""
from types import SimpleNamespace

from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.sites.selectors.modules import available_module_codes

from .menu_models import CUSTOM_PATH, validate_external_url
from .models import ContentStatus, Page, PublishedContentSnapshot, Visibility

SNAPSHOT_FIELDS = (
    "id", "site_id", "label", "item_type", "page_id", "post_id", "category_id",
    "target", "parent_id", "sort_order", "is_active",
)


def snapshot_items(menu):
    if hasattr(menu, "snapshot_item_rows"):
        rows = (
            {key: getattr(item, key) for key in SNAPSHOT_FIELDS}
            for item in menu.snapshot_item_rows
        )
    else:
        rows = menu.items.order_by("sort_order", "id").values(*SNAPSHOT_FIELDS)
    return [
        {
            key: str(value) if value is not None and (
                key.endswith("_id") and key != "site_id" or key == "id"
            ) else value
            for key, value in row.items()
        }
        for row in rows
    ]


def published_rows(menu):
    if menu.published_items is None:  # Trusted legacy system-created menus, until first publication.
        return list(menu.items.order_by("sort_order", "id"))
    return [
        SimpleNamespace(
            **{
                key: int(value) if key == "site_id" else value
                for key, value in row.items()
            },
            pk=row["id"],
        )
        for row in menu.published_items
    ]


def resolve_destination(item):
    return resolve_destinations((item,)).get(_item_key(item))


def resolve_destinations(items):
    """Resolve many destinations with a fixed query shape (not per-item)."""
    from apps.api.models import Category, Post

    now = timezone.now()
    items = list(items)
    resolved = {}
    page_ids, post_ids, category_ids = set(), set(), set()
    site_ids = set()

    for item in items:
        kind = item.item_type
        if kind in {"external", "custom"}:
            resolved[_item_key(item)] = _static_target(item)
            continue
        if kind not in {"page", "post", "news", "category"}:
            resolved[_item_key(item)] = None
            continue
        site_ids.add(item.site_id)
        if kind == "page" and item.page_id:
            page_ids.add(item.page_id)
        elif kind == "category" and item.category_id:
            category_ids.add(item.category_id)
        elif kind in {"post"} and item.post_id:
            post_ids.add(item.post_id)

    modules_by_site = {
        site_id: available_module_codes(site_id) for site_id in site_ids
    }
    pages = {
        str(row.pk): row
        for row in (
            Page.objects.filter(pk__in=page_ids, status=ContentStatus.PUBLISHED)
            if page_ids else ()
        )
    }
    posts = {
        str(row.pk): row
        for row in (
            Post.objects.filter(pk__in=post_ids, status=ContentStatus.PUBLISHED)
            if post_ids else ()
        )
    }
    categories = {
        str(row.pk): row
        for row in (
            Category.objects.filter(
                pk__in=category_ids, status=ContentStatus.PUBLISHED,
            )
            if category_ids else ()
        )
    }
    content_ids = {
        *(row.pk for row in pages.values()),
        *(row.pk for row in posts.values()),
        *(row.pk for row in categories.values()),
    }
    snapshots = {}
    if content_ids:
        for row in (
            PublishedContentSnapshot.objects
            .filter(content_id__in=content_ids)
            .order_by("content_id", "-version")
            .distinct("content_id")
        ):
            snapshots[str(row.content_id)] = row

    for item in items:
        key = _item_key(item)
        if key in resolved:
            continue
        kind = item.item_type
        module = "PAGES" if kind == "page" else "POSTS"
        if module not in modules_by_site.get(item.site_id, ()):
            resolved[key] = None
            continue
        if kind == "news":
            resolved[key] = "/posts"
            continue
        if kind == "page":
            obj = pages.get(str(item.page_id))
        elif kind == "category":
            obj = categories.get(str(item.category_id))
        else:
            obj = posts.get(str(item.post_id))
        if (
            obj is None
            or obj.site_id != item.site_id
            or (obj.published_at and obj.published_at > now)
        ):
            resolved[key] = None
            continue
        if kind == "category":
            resolved[key] = (
                "/posts/categories/" + obj.slug
                if obj.is_active and obj.published_at
                else None
            )
            continue
        if kind == "page" and obj.visibility not in {Visibility.PUBLIC, Visibility.UNLISTED}:
            resolved[key] = None
            continue
        publication = snapshots.get(str(obj.pk))
        payload = publication.payload if publication else {}
        if publication and publication.published_at > now:
            resolved[key] = None
            continue
        if kind == "page":
            resolved[key] = payload.get("path", obj.path)
        else:
            resolved[key] = "/posts/" + payload.get("slug", obj.slug)
    return resolved


def destination_state(item):
    return "ready" if resolve_destination(item) else "unavailable"


def menu_origin(site_id):
    from django.conf import settings
    from apps.sites.models import SiteDomain

    domain = SiteDomain.objects.filter(
        site_id=site_id, status="ACTIVE", is_primary=True,
    ).first()
    return (
        f"{'http' if settings.DEBUG else 'https'}://{domain.hostname}"
        if domain else None
    )


def _item_key(item):
    return getattr(item, "pk", None) or id(item)


def _static_target(item):
    kind = item.item_type
    try:
        if kind == "external":
            validate_external_url(item.target)
        elif not CUSTOM_PATH.fullmatch(item.target):
            return None
    except (ValidationError, TypeError):
        return None
    return item.target
