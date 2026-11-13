"""Published widget data and visitor contact receipts inside the resolved Site."""
import hashlib
import ipaddress
import socket
import time
from functools import lru_cache
from uuid import UUID
from urllib.parse import urlsplit

from django.db import transaction
from drf_spectacular.utils import extend_schema, OpenApiParameter
from rest_framework import serializers
from rest_framework.exceptions import APIException, NotFound, PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from apps.api.models import Category, Post, Tag
from apps.media.delivery import image_response, ImageDeliveryMixin, WebPImageRenderer
from apps.media.models import MediaAsset
from apps.organizations.hierarchy_lock import hierarchy_write
from apps.sites.api.access import Conflict
from apps.sites.api.serializers import StrictFields
from apps.sites.selectors.modules import module_is_available
from apps.sites.models import Site
from ..contact_models import ContactSubmission
from ..layout_contract import iter_nodes
from ..models import ContentStatus, Page, PublishedContentSnapshot, Visibility
from .public import _locale, _post_snapshot_data, _snapshot_data, _resolved_site
from ..selectors.pages import public_pages


class WidgetQuery(StrictFields, serializers.Serializer):
    source = serializers.ChoiceField(choices=("identity", "posts", "pages", "taxonomy", "menu"))
    menu_code = serializers.ChoiceField(choices=("header","footer","sidebar","primary","secondary"),default="header")
    limit = serializers.IntegerField(default=12, min_value=1, max_value=50)
    locale = serializers.CharField(required=False, max_length=35)
    category = serializers.SlugField(required=False, max_length=128)
    tag = serializers.SlugField(required=False, max_length=128)
    taxonomy_code = serializers.ChoiceField(choices=("categories", "category", "tags", "tag"), default="categories")

    def to_internal_value(self, data):
        if hasattr(data, "getlist") and any(len(data.getlist(key)) != 1 for key in data):
            raise serializers.ValidationError({"query": ["Supply each query parameter once."]})
        return super().to_internal_value(dict(data.items()))


class WidgetPayload(serializers.Serializer):
    site = serializers.IntegerField()
    source = serializers.CharField()
    results = serializers.ListField(child=serializers.DictField())


def logo_asset(site):
    reference = site.configuration["identity"]["logo_ref"]
    try:
        identifier = UUID(reference) if reference else None
    except (ValueError, TypeError):
        return None
    if not identifier or not module_is_available(site.pk, "MEDIA"):
        return None
    return MediaAsset.objects.filter(pk=identifier, site_id=site.pk, status="READY", deleted_at__isnull=True,
                                     detected_mime__in=("image/png", "image/jpeg", "image/webp")).exclude(
        processing__state__in=("QUEUED", "PROCESSING", "RETRY", "FAILED")).first()


def widget_data(site, parameters):
    source = parameters["source"]
    limit = parameters["limit"]
    if source == "menu":
        from ..selectors.menu_delivery import compose_location
        if not module_is_available(site.pk,"MENUS"):
            raise NotFound()
        return {"site":site.pk,"source":source,"results":compose_location(site.pk,parameters["menu_code"])}
    if source == "identity":
        asset = logo_asset(site)
        return {"site": site.pk, "source": source, "results": [{
            "name": site.configuration["identity"]["display_name"] or site.name,
            "logo_asset_id": str(asset.pk) if asset else None,
            "logo_url": "/api/v1/site-context/identity/logo/" if asset else None,
        }]}
    locale = _locale(site, parameters.get("locale"))
    if source == "pages":
        if not module_is_available(site.pk, "PAGES"):
            raise NotFound()
        if parameters.get("category") or parameters.get("tag"):
            raise serializers.ValidationError({"source": "Taxonomy filters apply to Posts."})
        data = _snapshot_data(list(public_pages(site.pk, locale)[:limit]))
        return {"site": site.pk, "source": source, "results": data}
    if not module_is_available(site.pk, "POSTS"):
        raise NotFound()
    from ..selectors.posts import published_posts
    if source == "taxonomy":
        eligible = published_posts(site.pk,locale).order_by().values("pk")
        model = Tag if parameters["taxonomy_code"] in ("tag", "tags") else Category
        terms = model.objects.filter(site_id=site.pk, locale=locale, is_active=True,
                                     posts__site_id=site.pk, posts__pk__in=eligible).distinct().order_by("name", "pk")
        data = list(terms.values("id", "code", "name", "slug")[:limit])
    else:
        posts = list(published_posts(site.pk,locale,category=parameters.get("category"),tag=parameters.get("tag"))[:min(limit,20)])
        data = _post_snapshot_data(posts, detail=False)
    return {"site": site.pk, "source": source, "results": data}


class PublicWidgetData(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(tags=["Public widgets"], parameters=[WidgetQuery], responses=WidgetPayload,
                   description="Resolve published widget data within the trusted Host Site. Taxonomy options include active terms used by published Posts. Responses contain public fields and canonical asset IDs.")
    def get(self, request):
        site = _resolved_site(request)
        query = WidgetQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        return Response(widget_data(site, query.validated_data), headers={"Cache-Control": "public, max-age=0, must-revalidate", "Vary": "Host"})


class PublicSiteLogo(ImageDeliveryMixin, APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    renderer_classes = [WebPImageRenderer]

    @extend_schema(tags=["Public widgets"], responses={(200, "image/webp"): {"type": "string", "format": "binary"}})
    def get(self, request):
        asset = logo_asset(_resolved_site(request))
        if asset is None:
            raise NotFound()
        return image_response(asset, "display")


class ContactInput(StrictFields, serializers.Serializer):
    request_id = serializers.UUIDField()
    name = serializers.CharField(max_length=200)
    email = serializers.EmailField(max_length=254)
    message = serializers.CharField(max_length=5000)


class ContactReceipt(serializers.Serializer):
    id = serializers.UUIDField()
    status = serializers.CharField()


@lru_cache(maxsize=2)
def nginx_addresses(time_window):
    """Refresh the trusted Compose proxy address each minute."""
    try:
        return set(socket.gethostbyname_ex("nginx")[2])
    except OSError:
        return set()


class ContactThrottle(SimpleRateThrottle):
    scope = "contact_submission"
    rate = "5/min"

    def get_cache_key(self, request, view):
        site = getattr(request, "site", None)
        peer = request.META.get("REMOTE_ADDR", "")
        address = request.META.get("HTTP_X_REAL_IP", peer) if peer in nginx_addresses(int(time.monotonic() // 60)) else peer
        try:
            address = str(ipaddress.ip_address(address))
        except ValueError:
            address = peer
        visitor = hashlib.sha256(address.encode()).hexdigest()
        return f"cms:contact:{site.pk if site else 'none'}:{visitor}"


class ContactBodyTooLarge(APIException):
    status_code = 413
    default_detail = "The contact message exceeds the request limit."


class PublicContact(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ContactThrottle]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        response["Vary"] = "Host, Origin"
        return response

    @extend_schema(tags=["Public widgets"], request=ContactInput, responses={202: ContactReceipt}, parameters=[
        OpenApiParameter("page_id", UUID, OpenApiParameter.PATH),
        OpenApiParameter("form_code", str, OpenApiParameter.PATH)],
        description="Accept a bounded inquiry for a Contact Form in the current published Page snapshot. Same request_id and payload replay the receipt. Conflicting reuse returns 409. Site/IP limit is five requests per minute. Visitor data remains Site-owned.")
    def post(self, request, page_id, form_code):
        site = _resolved_site(request)
        if not module_is_available(site.pk, "PAGES"):
            raise NotFound()
        origin = request.headers.get("Origin")
        if origin and urlsplit(origin).netloc.lower() != request.get_host().lower():
            raise PermissionDenied("Submit the form from this Site.")
        if int(request.META.get("CONTENT_LENGTH") or 0) > 32768:
            raise ContactBodyTooLarge()
        payload = ContactInput(data=request.data)
        payload.is_valid(raise_exception=True)
        with hierarchy_write(), transaction.atomic():
            if not Site.objects.filter(pk=site.pk, status=Site.Status.ACTIVE).exists() or not module_is_available(site.pk, "PAGES"):
                raise NotFound()
            page = Page.objects.filter(pk=page_id, site_id=site.pk, status=ContentStatus.PUBLISHED,
                                       visibility__in=(Visibility.PUBLIC, Visibility.UNLISTED)).first()
            if page is None:
                raise NotFound()
            snapshot = PublishedContentSnapshot.objects.filter(content_id=page.pk).order_by("-version").first()
            layout = snapshot.payload.get("metadata", {}).get("visual_layout") if snapshot else None
            if not layout or not any(node.get("type") == "contact_form" and node["props"]["form_code"] == form_code
                                     for node, _path in iter_nodes(layout)):
                raise NotFound()
            values = {"page_id": page.pk, "form_code": form_code,
                      **{key: value for key, value in payload.validated_data.items() if key != "request_id"}}
            row, created = ContactSubmission.objects.get_or_create(site=site, request_id=payload.validated_data["request_id"], defaults=values)
            if not created and any(getattr(row, key) != value for key, value in values.items()):
                raise Conflict("This request ID was already used for another message.")
        return Response({"id": row.pk, "status": "ACCEPTED"}, status=202)
