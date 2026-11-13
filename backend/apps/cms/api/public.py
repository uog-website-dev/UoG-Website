"""Published-only Page delivery for the Site resolved from the request Host."""
from urllib.parse import urlencode

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import NotFound
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.api.models import Post
from apps.sites.selectors.modules import module_available_on_request

from ..models import (
    ContentStatus,
    Page,
    PublishedContentSnapshot,
    Visibility,
)
from ..selectors.pages import homepage_of, public_pages, resolve_redirect
from ..services.publication_cache import (
    current_publication_version,
    get_public_cache,
    public_cache_key,
    set_public_cache,
)


class PublicPageSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    site = serializers.IntegerField()
    parent = serializers.UUIDField(allow_null=True)
    locale = serializers.CharField()
    status = serializers.ChoiceField(choices=(ContentStatus.PUBLISHED,))
    published_at = serializers.DateTimeField()
    publication_version = serializers.IntegerField()
    title = serializers.CharField()
    slug = serializers.CharField()
    path = serializers.CharField()
    layout = serializers.CharField(allow_blank=True)
    seo = serializers.JSONField()
    visibility = serializers.ChoiceField(choices=Visibility.choices)
    position = serializers.IntegerField()
    is_homepage = serializers.BooleanField()
    blocks = serializers.JSONField()
    blocks_version = serializers.CharField()
    metadata = serializers.JSONField()


class PublicPageListSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    next = serializers.URLField(allow_null=True)
    previous = serializers.URLField(allow_null=True)
    results = PublicPageSerializer(many=True)


class PublicPageQuery(serializers.Serializer):
    locale = serializers.CharField(required=False, max_length=35)
    parent = serializers.UUIDField(required=False)

    def to_internal_value(self, data):
        allowed = set(self.fields) | {"page", "page_size"}
        errors = {
            key: ["Unknown query parameter."]
            for key in set(data) - allowed
        }
        if hasattr(data, "getlist"):
            errors.update({
                key: ["Supply this query parameter only once."]
                for key in data if len(data.getlist(key)) != 1
            })
        if errors:
            raise serializers.ValidationError(errors)
        return super().to_internal_value({
            key: value for key, value in data.items() if key in self.fields
        })


class PublicLocaleQuery(serializers.Serializer):
    locale = serializers.CharField(required=False, max_length=35)

    def to_internal_value(self, data):
        errors = {
            key: ["Unknown query parameter."]
            for key in set(data) - {"locale"}
        }
        if hasattr(data, "getlist"):
            errors.update({
                key: ["Supply this query parameter only once."]
                for key in data if len(data.getlist(key)) != 1
            })
        if errors:
            raise serializers.ValidationError(errors)
        return super().to_internal_value(dict(data.items()))


class PublicPagePagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class PublicTaxonomySerializer(serializers.Serializer):
    id = serializers.UUIDField()
    code = serializers.CharField()
    name = serializers.CharField()
    slug = serializers.CharField()


class PublicPostListSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    site = serializers.IntegerField()
    locale = serializers.CharField()
    title = serializers.CharField()
    slug = serializers.CharField()
    excerpt = serializers.CharField(allow_blank=True)
    excerpt_html = serializers.CharField(allow_blank=True)
    featured_media = serializers.CharField(allow_blank=True)
    seo = serializers.JSONField()
    categories = PublicTaxonomySerializer(many=True)
    tags = PublicTaxonomySerializer(many=True)
    published_at = serializers.DateTimeField()
    publication_version = serializers.IntegerField()


class PublicPostDetailSerializer(PublicPostListSerializer):
    content = serializers.CharField()


class PublicPostPageSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    next = serializers.URLField(allow_null=True)
    previous = serializers.URLField(allow_null=True)
    results = PublicPostListSerializer(many=True)


class PublicPostQuery(serializers.Serializer):
    locale = serializers.CharField(required=False, max_length=35)
    category = serializers.SlugField(required=False, max_length=128)
    tag = serializers.SlugField(required=False, max_length=128)

    def to_internal_value(self, data):
        allowed = set(self.fields) | {"page", "page_size"}
        errors = {key: ["Unknown query parameter."] for key in set(data) - allowed}
        if hasattr(data, "getlist"):
            errors.update({
                key: ["Supply this query parameter only once."]
                for key in data if len(data.getlist(key)) != 1
            })
        if errors:
            raise serializers.ValidationError(errors)
        return super().to_internal_value({
            key: value for key, value in data.items() if key in self.fields
        })


class PublicPostListView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    pagination_class = PublicPagePagination
    http_method_names = ["get", "head", "options"]

    @extend_schema(
        operation_id="public_site_posts_list",
        tags=["Public Posts"],
        parameters=[
            OpenApiParameter("locale", str, description="Enabled Site language; defaults to the Site language."),
            OpenApiParameter("category", str, description="Active Category slug owned by this Site."),
            OpenApiParameter("tag", str, description="Active Tag slug owned by this Site."),
            OpenApiParameter("page", int),
            OpenApiParameter("page_size", int, description="Default 20, maximum 100."),
        ],
        responses=PublicPostPageSerializer,
        description=(
            "List published Posts for the Site resolved from the trusted Host. "
            "Results use immutable publication snapshots and deterministic "
            "publication-time/id ordering. Category and Tag filters resolve "
            "only active taxonomy owned by that Site."
        ),
    )
    def get(self, request):
        site = _resolved_site(request)
        _require_posts_module(request)
        query = PublicPostQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        filters = query.validated_data
        locale = _locale(site, filters.get("locale"))
        posts = Post.objects.filter(
            site_id=site.pk, locale=locale, status=ContentStatus.PUBLISHED,
        )
        if "category" in filters:
            posts = posts.filter(
                categories__site_id=site.pk, categories__locale=locale,
                categories__is_active=True, categories__slug=filters["category"],
            )
        if "tag" in filters:
            posts = posts.filter(
                tags__site_id=site.pk, tags__locale=locale,
                tags__is_active=True, tags__slug=filters["tag"],
            )
        posts = posts.distinct().order_by("-published_at", "-pk")
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(posts, request, view=self)
        resource = (
            f"posts:locale={locale}:category={filters.get('category', '')}:"
            f"tag={filters.get('tag', '')}:page={request.query_params.get('page', '1')}:"
            f"size={request.query_params.get('page_size', paginator.page_size)}"
        )
        version = current_publication_version(site.pk, locale)
        key = public_cache_key(site.pk, locale, resource, version=version)
        results = get_public_cache(site.pk, key)
        if results is None:
            results = _post_snapshot_data(page, detail=False)
            set_public_cache(site.pk, key, results)
        response = paginator.get_paginated_response(results)
        _public_post_headers(response, version)
        return response


class PublicPostDetailView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    http_method_names = ["get", "head", "options"]

    @extend_schema(
        operation_id="public_site_post_detail",
        tags=["Public Posts"],
        parameters=[
            OpenApiParameter("post_slug", str, OpenApiParameter.PATH),
            OpenApiParameter("locale", str, description="Enabled Site language; defaults to the Site language."),
        ],
        responses=PublicPostDetailSerializer,
        description=(
            "Return a published Post by slug within the Site resolved from "
            "the trusted Host. Foreign-Site, draft and missing Posts return "
            "the same not-found response."
        ),
    )
    def get(self, request, post_slug):
        site = _resolved_site(request)
        _require_posts_module(request)
        query = PublicLocaleQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        locale = _locale(site, query.validated_data.get("locale"))
        post = Post.objects.filter(
            site_id=site.pk, locale=locale, slug=post_slug,
            status=ContentStatus.PUBLISHED,
        ).first()
        if post is None:
            raise NotFound("The requested Post was not found.")
        version = current_publication_version(site.pk, locale)
        key = public_cache_key(
            site.pk, locale, f"post:{post_slug}", version=version,
        )
        data = get_public_cache(site.pk, key)
        if data is None:
            data = _post_snapshot_data([post], detail=True)[0]
            set_public_cache(site.pk, key, data)
        response = Response(data)
        _public_post_headers(response, version)
        response["ETag"] = f'"cms-post-{post.pk}-publication-{data["publication_version"]}"'
        return response


def _post_snapshot_data(posts, *, detail):
    post_ids = [post.pk for post in posts]
    latest = {}
    for snapshot in PublishedContentSnapshot.objects.filter(
        content_id__in=post_ids,
    ).order_by("content_id", "-version"):
        latest.setdefault(snapshot.content_id, snapshot)
    if set(post_ids) != set(latest):
        raise RuntimeError("A published Post is missing its serving snapshot.")
    serializer = PublicPostDetailSerializer if detail else PublicPostListSerializer
    return [serializer(_post_snapshot_payload(latest[post.pk])).data for post in posts]


def _post_snapshot_payload(snapshot):
    payload = snapshot.payload
    data = {
        "id": payload["content_id"],
        "site": payload["site_id"],
        "locale": payload["locale"],
        "title": payload["title"],
        "slug": payload["slug"],
        "excerpt": payload["excerpt"],
        "excerpt_html": payload["excerpt_html"],
        "featured_media": payload["featured_media"],
        "seo": payload["seo"],
        "categories": payload["categories"],
        "tags": payload["tags"],
        "published_at": snapshot.published_at,
        "publication_version": snapshot.version,
    }
    if "content" in payload:
        data["content"] = payload["content"]
    return data


def _public_post_headers(response, version):
    response["Cache-Control"] = "public, max-age=0, must-revalidate"
    response["X-Publication-Version"] = str(version)
    response["Vary"] = "Host"


def _require_posts_module(request):
    if not module_available_on_request(request, "POSTS"):
        raise NotFound("The requested Post was not found.")


class PublicPageListView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    pagination_class = PublicPagePagination
    http_method_names = ["get", "head", "options"]

    @extend_schema(
        operation_id="public_site_pages_list",
        tags=["Public Pages"],
        parameters=[
            OpenApiParameter("locale", str, description="Enabled Site language; defaults to the Site language."),
            OpenApiParameter("parent", str, description="Optional parent Page UUID."),
            OpenApiParameter("page", int),
            OpenApiParameter("page_size", int, description="Default 20, maximum 100."),
        ],
        responses=PublicPageListSerializer,
        description=(
            "List PUBLIC Pages from immutable publication snapshots for the "
            "Site resolved from the trusted Host. Site identifiers in query "
            "parameters are rejected. Draft, hidden and unlisted Pages are "
            "never listed."
        ),
    )
    def get(self, request):
        site = _resolved_site(request)
        _require_pages_module(request)
        query = PublicPageQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        locale = _locale(site, query.validated_data.get("locale"))
        version = current_publication_version(site.pk, locale)
        queryset = public_pages(site.pk, locale)
        if "parent" in query.validated_data:
            queryset = queryset.filter(parent_id=query.validated_data["parent"])

        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        resource = (
            f"list:parent={query.validated_data.get('parent', '')}:"
            f"page={request.query_params.get('page', '1')}:"
            f"size={request.query_params.get('page_size', paginator.page_size)}"
        )
        key = public_cache_key(site.pk, locale, resource, version=version)
        results = get_public_cache(site.pk, key)
        if results is None:
            results = _snapshot_data(page)
            set_public_cache(site.pk, key, results)
        response = paginator.get_paginated_response(results)
        response["Cache-Control"] = "public, max-age=0, must-revalidate"
        response["X-Publication-Version"] = str(version)
        response["Vary"] = "Host"
        return response


class PublicPageDetailView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    http_method_names = ["get", "head", "options"]

    @extend_schema(
        tags=["Public Pages"],
        parameters=[
            OpenApiParameter("page_path", str, OpenApiParameter.PATH, description="Full Page route path within the resolved Site."),
            OpenApiParameter("locale", str, description="Enabled Site language; defaults to the Site language."),
        ],
        responses=PublicPageSerializer,
        description=(
            "Resolve the full route only within the Site selected from the "
            "trusted Host. Unknown, draft, hidden and foreign-Site routes "
            "all return the same not-found response."
        ),
    )
    def get(self, request, page_path):
        site = _resolved_site(request)
        _require_pages_module(request)
        query = PublicLocaleQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        locale = _locale(site, query.validated_data.get("locale"))
        path = "/" + page_path.strip("/")
        if path == "/":
            page = _eligible_homepage(site.pk, locale)
        else:
            page = Page.objects.filter(
                site_id=site.pk, locale=locale, path=path,
                status=ContentStatus.PUBLISHED,
                visibility__in=(Visibility.PUBLIC, Visibility.UNLISTED),
            ).first()
        if page is None:
            redirect = resolve_redirect(site.pk, locale, path)
            if (
                redirect is None
                or redirect.page.status != ContentStatus.PUBLISHED
                or redirect.page.visibility not in {
                    Visibility.PUBLIC, Visibility.UNLISTED,
                }
            ):
                raise NotFound("The requested Page was not found.")
            location = f"/api/v1/site-context/pages{redirect.page.path}/"
            query_string = (
                urlencode({"locale": locale})
                if request.query_params.get("locale") else ""
            )
            if query_string:
                location = f"{location}?{query_string}"
            response = Response(status=308, headers={"Location": location})
            response["Cache-Control"] = "public, max-age=0, must-revalidate"
            response["Vary"] = "Host"
            return response
        return _cached_page_response(page)


class PublicHomepageView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    http_method_names = ["get", "head", "options"]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "public, max-age=0, must-revalidate"
        response["Vary"] = "Host"
        return response

    @extend_schema(
        operation_id="public_site_homepage",
        tags=["Public Pages"],
        parameters=[OpenApiParameter("locale", str)],
        responses=PublicPageSerializer,
        description=(
            "Return the published homepage for the Site resolved from the "
            "trusted Host. The explicit Site assignment takes precedence. "
            "An unavailable, hidden or unpublished assignment returns 404, "
            "the portal's empty root fallback. No arbitrary replacement or "
            "draft is served. Responses vary by Host and must revalidate."
        ),
    )
    def get(self, request):
        site = _resolved_site(request)
        _require_pages_module(request)
        query = PublicLocaleQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        locale = _locale(site, query.validated_data.get("locale"))
        page = _eligible_homepage(site.pk, locale)
        if page is None:
            raise NotFound("The requested Page was not found.")
        return _cached_page_response(page)


def _resolved_site(request):
    site = getattr(request, "site", None)
    if site is None:
        raise NotFound("The requested Page was not found.")
    return site


def _eligible_homepage(site_id, locale):
    page = homepage_of(site_id)
    if (page and page.locale == locale and page.status == ContentStatus.PUBLISHED
            and page.visibility in (Visibility.PUBLIC, Visibility.UNLISTED)
            and PublishedContentSnapshot.objects.filter(content_id=page.pk).exists()):
        return page
    return None


def _require_pages_module(request):
    if not module_available_on_request(request, "PAGES"):
        raise NotFound("The requested Page was not found.")


def _locale(site, requested):
    enabled = (site.configuration or {}).get("language", {}).get("enabled")
    enabled = (
        [str(value) for value in enabled]
        if isinstance(enabled, list) and enabled
        else [site.default_language]
    )
    locale = (requested or site.default_language).strip().lower()
    if locale not in enabled:
        raise NotFound("The requested Page was not found.")
    return locale


def _snapshot_data(pages):
    page_ids = [page.pk for page in pages]
    latest = {}
    snapshots = PublishedContentSnapshot.objects.filter(
        content_id__in=page_ids,
    ).order_by("content_id", "-version")
    for snapshot in snapshots:
        latest.setdefault(snapshot.content_id, snapshot)
    if set(page_ids) != set(latest):
        raise RuntimeError("A published Page is missing its serving snapshot.")
    data = []
    homepages = {site_id: homepage_of(site_id) for site_id in {page.site_id for page in pages}}
    for page in pages:
        snapshot = latest.get(page.pk)
        document = _serialize_snapshot(snapshot)
        selected = homepages[page.site_id]
        document["is_homepage"] = bool(selected and selected.pk == page.pk)
        data.append(document)
    return data


def _serialize_snapshot(snapshot):
    payload = snapshot.payload
    return PublicPageSerializer({
        "id": payload["content_id"],
        "site": payload["site_id"],
        "parent": payload.get("parent_id"),
        "locale": payload["locale"],
        "status": ContentStatus.PUBLISHED,
        "published_at": snapshot.published_at,
        "publication_version": snapshot.version,
        "title": payload["title"],
        "slug": payload["slug"],
        "path": payload["path"],
        "layout": payload["layout"],
        "seo": payload["seo"],
        "visibility": payload["visibility"],
        "position": payload["position"],
        "is_homepage": payload["is_homepage"],
        "blocks": payload["blocks"],
        "blocks_version": payload["blocks_version"],
        "metadata": payload["metadata"],
    }).data


def _cached_page_response(page):
    version = current_publication_version(page.site_id, page.locale)
    key = public_cache_key(
        page.site_id, page.locale, f"page:{page.path}", version=version,
    )
    data = get_public_cache(page.site_id, key)
    if data is None:
        snapshot = PublishedContentSnapshot.objects.filter(
            content_id=page.pk,
        ).order_by("-version").first()
        if snapshot is None:
            raise RuntimeError("A published Page is missing its serving snapshot.")
        data = _serialize_snapshot(snapshot)
        set_public_cache(page.site_id, key, data)
    response = Response(data)
    selected = homepage_of(page.site_id)
    response.data = {**data, "is_homepage": bool(selected and selected.pk == page.pk)}
    response["Cache-Control"] = "public, max-age=0, must-revalidate"
    response["ETag"] = (
        f'"cms-page-{page.pk}-publication-{data["publication_version"]}-site-{version}"'
    )
    response["X-Publication-Version"] = str(version)
    response["Vary"] = "Host"
    return response
