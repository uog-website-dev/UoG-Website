"""
Cache key helpers.

The platform cache (Redis) is shared by all future institutional sites, so
keys go through this function to guarantee a stable, prefixed namespace.

Extension point for later stories: when Organization/Site scoping lands, add
organization/site segments here (resolved from request or task context)
instead of sprinkling prefixes through call sites.
"""
from typing import Optional


def make_cache_key(key: str, key_prefix: str, version: Optional[int] = None) -> str:
    """Build ``{key_prefix}:{key}:v{version}`` (Django KEY_FUNCTION contract)."""
    if version is not None:
        key = f"{key}:v{version}"
    return f"{key_prefix}:{key}" if key_prefix else key
