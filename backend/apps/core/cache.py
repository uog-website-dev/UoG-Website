"""
Cache key helpers.

The platform cache is shared by every institutional site. Keys include the
resolved Site id, or ``platform`` when the request is not a website, so one
site cannot read another's cached entry.
"""
from contextvars import ContextVar
from typing import Optional

_cache_site = ContextVar("platform_cache_site", default="platform")


def bind_cache_site(site_id):
    return _cache_site.set("platform" if site_id is None else str(site_id))


def reset_cache_site(token):
    _cache_site.reset(token)


def current_cache_site():
    return _cache_site.get()


def make_cache_key(key: str, key_prefix: str, version: Optional[int] = None) -> str:
    """Build ``{key_prefix}:site:{site}:{key}:v{version}``."""
    scoped = f"site:{current_cache_site()}:{key}"
    if version is not None:
        scoped = f"{scoped}:v{version}"
    return f"{key_prefix}:{scoped}" if key_prefix else scoped
