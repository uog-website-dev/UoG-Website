"""Cross-domain dashboard composition: small aggregates, never content serialization."""
import logging
from datetime import timedelta

from django.db import DatabaseError, transaction
from django.db.models import Count, Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from apps.authorization.services import effective_permission_sets
from apps.authorization.models import UserRoleAssignment
from apps.cms.authorization import cms_grant_allows
from apps.cms.models import ContentRole, ContentStatus, Page
from apps.cms.menu_models import Menu, MenuItem
from apps.api.models import Post
from apps.media.models import MediaAsset
from apps.sites.models import Site
from apps.sites.selectors.modules import available_module_codes
from apps.sites.api.workspace import PrivateWorkspaceView, StrictQuery
from . import dashboard_cache

logger = logging.getLogger(__name__)


class DashboardQuery(StrictQuery):
    site = serializers.IntegerField(min_value=1, max_value=9007199254740991)


class SectionSummary(serializers.Serializer):
    status = serializers.ChoiceField(choices=["ready", "unavailable"])
    counts = serializers.DictField(child=serializers.IntegerField(min_value=0), required=False)


class CacheInfo(serializers.Serializer):
    hit = serializers.BooleanField()
    available = serializers.BooleanField()
    ttl_seconds = serializers.IntegerField()


class DashboardResponse(serializers.Serializer):
    schema_version = serializers.IntegerField()
    site = serializers.IntegerField()
    generated_at = serializers.DateTimeField()
    expires_at = serializers.DateTimeField()
    partial = serializers.BooleanField()
    sections = serializers.DictField(child=SectionSummary())
    cache = CacheInfo()


class ActivityItem(serializers.Serializer):
    id = serializers.UUIDField()
    kind = serializers.ChoiceField(choices=["pages", "posts"])
    title = serializers.CharField()
    status = serializers.CharField()
    updated_at = serializers.DateTimeField()


class ActivityResponse(serializers.Serializer):
    site = serializers.IntegerField()
    generated_at = serializers.DateTimeField()
    results = ActivityItem(many=True)


def authorized_context(request):
    query = DashboardQuery(data=request.query_params)
    query.is_valid(raise_exception=True)
    site = Site.objects.only("id", "organization_unit_id").filter(pk=query.validated_data["site"]).first()
    if site is None:
        raise NotFound()
    permissions = set(effective_permission_sets(request.user, [(site.organization_unit_id, site.pk)])[0])
    if "sites.view" not in permissions:
        raise NotFound()
    modules = available_module_codes(site.pk)
    readable = cms_grant_allows(request.user, site.pk, ContentRole.values) if (
        ("PAGES" in modules and "content.pages.view" in permissions)
        or ("POSTS" in modules and "content.posts.view" in permissions)
    ) else False
    allowed = {
        key for key, module, permission in (
            ("pages", "PAGES", "content.pages.view"), ("posts", "POSTS", "content.posts.view"),
            ("menus", "MENUS", "menu.read"), ("media", "MEDIA", "content.media.view"),
            ("users", None, "platform.users.view"),
        ) if permission in permissions and (module is None or module in modules)
        and (key not in {"pages", "posts"} or readable)
    }
    return site, permissions, modules, readable, allowed


def content_counts(model, site_id):
    return model.objects.filter(site_id=site_id).aggregate(
        total=Count("pk"), **{status: Count("pk", filter=Q(status=status)) for status in ContentStatus.values},
    )


def aggregate_section(kind, site_id):
    if kind in {"pages", "posts"}:
        return content_counts(Page if kind == "pages" else Post, site_id)
    if kind == "menus":
        rows = Menu.objects.filter(site_id=site_id, is_global=False)
        result = rows.aggregate(total=Count("pk"), active=Count("pk", filter=Q(is_active=True)))
        result["items"] = MenuItem.objects.filter(site_id=site_id, menu__site_id=site_id, menu__is_global=False).count()
        return result
    if kind == "media":
        return {"total": MediaAsset.objects.filter(site_id=site_id, deleted_at__isnull=True).count()}
    now = timezone.now()
    return {"total": UserRoleAssignment.objects.filter(
        site_id=site_id, scope="SITE", revoked_at__isnull=True, role__is_active=True, user__is_active=True,
    ).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now)).aggregate(total=Count("user_id", distinct=True))["total"]}


class DashboardSummary(PrivateWorkspaceView):
    @extend_schema(parameters=[DashboardQuery], responses=DashboardResponse, tags=["Workspace"],
        description="Essential Site counts. Live membership/capability and module checks precede each cache lookup. Unauthorized and unknown Sites both return 404. Omitted sections are not readable/enabled. Existing CMS readers may inspect all draft statuses, matching scoped list policy. No titles, storage references or user profiles. Redis TTL defaults to 15 seconds (maximum 60); committed model writes bump a Site generation; bulk SQL/expiry changes rely on bounded TTL. Failed sections are unavailable, never zero or cached.")
    def get(self, request):
        site, permissions, modules, readable, allowed = authorized_context(request)
        key, available = None, True
        try:
            key = dashboard_cache.cache_key(site.pk, request.user.pk, permissions, modules, readable)
            with dashboard_cache.namespace(site.pk):
                cached = dashboard_cache.backend().get(key)
            if cached is not None:
                return Response({**cached, "cache": {"hit": True, "available": True, "ttl_seconds": dashboard_cache.ttl()}})
        except Exception:
            available = False
            logger.warning("Dashboard cache unavailable; computing live aggregates")
        sections = {}
        for kind in sorted(allowed):
            try:
                # A failed query must not poison another section's transaction.
                with transaction.atomic():
                    counts = aggregate_section(kind, site.pk)
                sections[kind] = {"status": "ready", "counts": counts}
            except DatabaseError:
                sections[kind] = {"status": "unavailable"}
                logger.warning("Dashboard aggregate unavailable", extra={"section": kind, "site": site.pk})
        now = timezone.now()
        payload = {"schema_version": 1, "site": site.pk, "generated_at": now.isoformat(),
                   "expires_at": (now + timedelta(seconds=dashboard_cache.ttl())).isoformat(),
                   "partial": any(row["status"] != "ready" for row in sections.values()), "sections": sections}
        if key and available and not payload["partial"]:
            try:
                with dashboard_cache.namespace(site.pk):
                    dashboard_cache.backend().set(key, payload, timeout=dashboard_cache.ttl())
            except Exception:
                available = False
        return Response({**payload, "cache": {"hit": False, "available": available, "ttl_seconds": dashboard_cache.ttl()}})


class DashboardActivity(PrivateWorkspaceView):
    @extend_schema(parameters=[DashboardQuery], responses=ActivityResponse, tags=["Workspace"],
        description="Optional secondary widget. Five most recently modified readable Page/Post records, ordered updated_at descending then UUID. Same live Site/CMS/module gates as counts. No bodies, private media paths or user profiles. No shared activity cache.")
    def get(self, request):
        site, _, _, _, allowed = authorized_context(request)
        rows = []
        for kind, model in (("pages", Page), ("posts", Post)):
            if kind in allowed:
                rows.extend({**row, "kind": kind} for row in model.objects.filter(site_id=site.pk)
                            .order_by("-updated_at", "-pk").values("id", "title", "status", "updated_at")[:5])
        rows.sort(key=lambda row: (row["updated_at"], str(row["id"])), reverse=True)
        return Response({"site": site.pk, "generated_at": timezone.now().isoformat(), "results": rows[:5]})
