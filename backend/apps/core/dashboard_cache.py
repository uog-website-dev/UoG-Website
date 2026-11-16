"""Bounded, Site-partitioned dashboard data; authorization is never cached."""
import hashlib
import json
import logging
import uuid
from contextlib import contextmanager

from django.conf import settings
from django.core.cache import caches
from django.db import transaction

from .cache import bind_cache_site, reset_cache_site

logger = logging.getLogger(__name__)


def ttl():
    return max(1, min(60, int(getattr(settings, "DASHBOARD_SUMMARY_TTL", 15))))


def backend():
    # Service-isolated test suites intentionally provide only a local default.
    return caches["dashboard" if "dashboard" in settings.CACHES else "default"]


@contextmanager
def namespace(site_id):
    token = bind_cache_site(site_id)
    try:
        yield
    finally:
        reset_cache_site(token)


def version(site_id):
    with namespace(site_id):
        key = "dashboard:generation:v1"
        value = backend().get(key)
        if value is None:
            backend().add(key, uuid.uuid4().hex, timeout=3600)
            value = backend().get(key)
        return value


def cache_key(site_id, user_id, permissions, modules, cms_readable):
    fingerprint = hashlib.sha256(json.dumps([sorted(permissions), sorted(modules), cms_readable]).encode()).hexdigest()
    return f"dashboard:summary:v1:{site_id}:{user_id}:{fingerprint}:{version(site_id)}"


def invalidate(site_id, *, using="default"):
    if not site_id:
        return

    def committed():
        try:
            with namespace(site_id):
                backend().set("dashboard:generation:v1", uuid.uuid4().hex, timeout=3600)
        except Exception:
            # Never roll back a successful write because Redis is unavailable.
            logger.warning("Dashboard invalidation unavailable; bounded TTL applies")
    transaction.on_commit(committed, using=using)


def register_signals():
    from django.db.models.signals import post_delete, post_save
    from apps.api.models import Post
    from apps.authorization.models import UserRoleAssignment
    from apps.cms.models import Page, SiteContent
    from apps.cms.menu_models import Menu, MenuItem
    from apps.media.models import MediaAsset

    def changed(sender, instance, using, **kwargs):
        invalidate(getattr(instance, "site_id", None), using=using)

    for model in (SiteContent, Page, Post, Menu, MenuItem, MediaAsset, UserRoleAssignment):
        for signal in (post_save, post_delete):
            signal.connect(changed, sender=model, weak=False, dispatch_uid=f"dashboard-v1:{signal}:{model._meta.label_lower}")
