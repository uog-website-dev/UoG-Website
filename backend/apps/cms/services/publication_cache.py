"""Site- and locale-scoped publication cache generations."""
from contextlib import contextmanager

from django.core.cache import cache
from django.db import DEFAULT_DB_ALIAS
from django.db.models import F
from django.utils import timezone

from apps.core.cache import bind_cache_site, reset_cache_site

from ..models import SitePublicationVersion

PUBLIC_CACHE_TTL_SECONDS = 300


@contextmanager
def _site_cache_scope(site_id):
    token = bind_cache_site(site_id)
    try:
        yield
    finally:
        reset_cache_site(token)


def public_cache_key(site_id, locale, resource, *, version):
    return (
        f"cms:site:{site_id}:locale:{locale}:publication:{version}:{resource}"
    )


def current_publication_version(site_id, locale, *, using=DEFAULT_DB_ALIAS):
    return (
        SitePublicationVersion.objects.using(using)
        .filter(site_id=site_id, locale=locale)
        .values_list("version", flat=True)
        .first()
        or 0
    )


def bump_publication_version(site_id, locale, *, path, using=DEFAULT_DB_ALIAS):
    """Advance the generation and drop the previous direct-route cache entry."""
    version, _created = SitePublicationVersion.objects.using(using).get_or_create(
        site_id=site_id,
        locale=locale,
        defaults={"version": 0},
    )
    previous_version = version.version
    SitePublicationVersion.objects.using(using).filter(
        pk=version.pk,
    ).update(version=F("version") + 1, updated_at=timezone.now())
    version.refresh_from_db(using=using, fields=("version",))

    old_page_key = public_cache_key(
        site_id, locale, f"page:{path}", version=previous_version,
    )
    with _site_cache_scope(site_id):
        cache.delete(old_page_key)
    return version.version


def get_public_cache(site_id, key):
    with _site_cache_scope(site_id):
        return cache.get(key)


def set_public_cache(site_id, key, value):
    with _site_cache_scope(site_id):
        cache.set(key, value, timeout=PUBLIC_CACHE_TTL_SECONDS)
