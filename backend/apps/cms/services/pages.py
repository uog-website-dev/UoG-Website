"""Page writes: creation, route changes with URL history, homepage swaps.

Every operation runs inside a transaction so a partially applied hierarchy
change (or a homepage swap that cleared the old flag but failed to set the
new one) can never be observed. Authorship is taken from the caller — the
authenticated principal — never from a request body.
"""
from django.core.exceptions import ValidationError
from django.db import transaction

from ..models import ContentStatus, Page, PageRedirect, Visibility

_UNCHANGED = object()


def create_page(
    *, site, title, slug, parent=None, locale="", layout="", seo=None,
    visibility=Visibility.PUBLIC, position=0, metadata=None, blocks=None,
    actor=None,
):
    """Create one page. Route, locale inheritance and validation are the
    model's job; this only assembles the row and records authorship."""
    page = Page(
        site=site, title=title, slug=slug, parent=parent, locale=locale,
        layout=layout, seo=seo or {}, visibility=visibility,
        position=position, metadata=metadata or {},
        blocks=blocks if blocks is not None else [],
    )
    if actor is not None:
        page.created_by = actor
        page.updated_by = actor
    page.save()
    return page


def change_route(page, *, slug=_UNCHANGED, parent=_UNCHANGED, actor=None):
    """Rename or re-parent a page, keeping URL history for the whole subtree.

    Descendants are re-saved parent-first so their paths recompute from the
    changed ancestor. Every path that disappears is recorded as a redirect,
    and any redirect whose target path is live again is removed so a route
    is never shadowed by its own history.
    """
    with transaction.atomic():
        subtree = [page] + _descendants(page)
        # Authoritative paths from the database, not possibly stale copies.
        history = dict(
            Page.objects.filter(pk__in=[item.pk for item in subtree])
            .values_list("pk", "path")
        )
        if slug is not _UNCHANGED:
            if not isinstance(slug, str) or not slug.strip():
                raise ValueError("slug must be a non-empty string or omitted")
            page.slug = slug
        if parent is not _UNCHANGED:
            page.parent = parent
        if actor is not None:
            page.updated_by = actor
        # Commit-atomically *and* in memory: clean() may mutate unsaved
        # state (path, slug) before raising, and a caller catching the
        # validation error must not observe a route that was never written.
        original = (page.slug, page.parent, history[page.pk])
        try:
            page.save()
            for descendant in subtree[1:]:
                descendant.save()
        except Exception:
            page.slug, page.parent, page.path = original
            raise
        for item in subtree:
            old = history.get(item.pk)
            if old and old != item.path:
                PageRedirect.objects.update_or_create(
                    site_id=item.site_id, locale=item.locale, old_path=old,
                    defaults={"page": item},
                )
        live = [item.path for item in subtree]
        PageRedirect.objects.filter(
            site_id=page.site_id, locale=page.locale, old_path__in=live,
        ).delete()
        return page


def require_pages_module(site_id, *, using="default"):
    """Refuse a management write when PAGES is off. Callers do not delete the row."""
    from apps.sites.selectors.modules import module_is_available
    if not module_is_available(site_id, "PAGES", using=using):
        raise ValidationError({"module": "The PAGES module is not enabled for this Site."})


def set_as_homepage(page, *, actor=None):
    """Designate this page as the Site's homepage, replacing any previous
    one atomically: either the swap happens entirely or neither flag moved."""
    if page.status not in {ContentStatus.DRAFT, ContentStatus.UNPUBLISHED}:
        raise ValidationError({
            "status": "Set the homepage while the Page is draft or unpublished.",
        })
    with transaction.atomic():
        previous_homepages = Page.objects.filter(
            site_id=page.site_id, is_homepage=True,
        ).exclude(pk=page.pk)
        for previous in previous_homepages:
            previous.is_homepage = False
            if actor is not None:
                previous.updated_by = actor
            previous.save()
        page.is_homepage = True
        if actor is not None:
            page.updated_by = actor
        page.save()
    return page


def _descendants(root):
    """All pages below root, parents before children."""
    ordered = []
    frontier = [root.pk]
    while frontier:
        children = list(
            Page.objects.filter(parent_id__in=frontier).order_by("position", "id")
        )
        ordered.extend(children)
        frontier = [child.pk for child in children]
    return ordered
