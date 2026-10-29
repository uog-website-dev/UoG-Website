"""Which pages the public URL space actually answers.

Every selector here is the serving contract: drafts are never returned,
HIDDEN pages are never returned, and nothing is assumed about a Site the
caller does not own — results are always scoped by explicit Site and locale.
"""
from django.db import DEFAULT_DB_ALIAS

from ..models import ContentStatus, Page, PageRedirect, Visibility

#: Visibilities a published page answers its direct route with. UNLISTED is
#: served but never listed; HIDDEN is never served publicly.
SERVED_VISIBILITIES = (Visibility.PUBLIC, Visibility.UNLISTED)


def published_page(site_id, locale, path, *, using=DEFAULT_DB_ALIAS):
    """The live page for one route, or None.

    Drafts and hidden pages are deliberately not served: status must be
    PUBLISHED and the visibility must be served.
    """
    return (
        Page.objects.using(using)
        .filter(
            site_id=site_id, locale=locale, path=path,
            status=ContentStatus.PUBLISHED,
            visibility__in=SERVED_VISIBILITIES,
        )
        .first()
    )


def public_pages(site_id, locale, *, using=DEFAULT_DB_ALIAS):
    """Listed pages: published and public, in sibling order."""
    return (
        Page.objects.using(using)
        .filter(
            site_id=site_id, locale=locale,
            status=ContentStatus.PUBLISHED,
            visibility=Visibility.PUBLIC,
        )
        .order_by("position", "id")
    )


def homepage_of(site_id, *, using=DEFAULT_DB_ALIAS):
    """The page flagged to serve the Site root, regardless of status.

    The serving layer must still apply the published/served rules before
    rendering it — configuring a homepage does not publish it.
    """
    return (
        Page.objects.using(using)
        .filter(site_id=site_id, is_homepage=True)
        .first()
    )


def resolve_redirect(site_id, locale, path, *, using=DEFAULT_DB_ALIAS):
    """URL history for a route that no longer exists.

    Consult only when no live page matched: a live route always wins, and
    the redirect points at the page's current path (redirects are
    re-pointed, never chained).
    """
    return (
        PageRedirect.objects.using(using)
        .filter(site_id=site_id, locale=locale, old_path=path)
        .select_related("page")
        .first()
    )
