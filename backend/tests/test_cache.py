"""Cache configuration and key-scoping tests."""
from django.core.cache import cache

from apps.core.cache import make_cache_key


def test_cache_roundtrip():
    cache.set("test-key", "value", timeout=30)
    assert cache.get("test-key") == "value"
    cache.delete("test-key")


def test_cache_key_function_applies_prefix_and_version():
    # Django's KEY_FUNCTION contract: key_func(key, key_prefix, version).
    assert make_cache_key("pages:all", "uog", 1) == "uog:pages:all:v1"


def test_cache_key_function_without_prefix_or_version():
    assert make_cache_key("pages:all", "", None) == "pages:all"
