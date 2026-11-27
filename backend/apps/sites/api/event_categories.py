"""Site-scoped Event category administration. Site Administrator only."""
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.api.models import Category
from apps.authorization.access import effective_scope_for_site
from apps.authorization.services import permission_granted
from apps.sites.events import EVENTS_MODULE_CODE, require_events_module
from apps.sites.models import Site
from apps.sites.selectors.modules import module_is_available


class EventCategorySerializer(serializers.ModelSerializer):
    code = serializers.CharField(required=False, max_length=64)
    slug = serializers.SlugField(required=False, allow_blank=True, max_length=128)

    class Meta:
        model = Category
        fields = (
            "id", "code", "name", "slug", "description", "position",
            "is_active", "locale", "created_at", "updated_at",
        )
        read_only_fields = ("id",)

    def validate_name(self, value):
        if not value.strip():
            raise serializers.ValidationError("Enter a category name.")
        return value.strip()

    def validate(self, attrs):
        if not attrs.get("slug"):
            from django.utils.text import slugify
            if attrs.get("name"):
                attrs["slug"] = slugify(attrs["name"])[:128]
            elif self.instance:
                attrs["slug"] = self.instance.slug
        if not attrs.get("slug"):
            raise serializers.ValidationError({
                "name": "Use a category name containing letters or numbers.",
            })
        return attrs


def _require_site_admin(user, site: Site) -> None:
    if not permission_granted(
        user, "sites.update", site_id=site.pk,
        organization_id=effective_scope_for_site(site.pk), audit=False,
    ):
        raise PermissionDenied("A Site Administrator is required to manage Event categories.")


def _site_with_events(site_pk: int) -> Site:
    site = get_object_or_404(Site, pk=site_pk)
    if not module_is_available(site.pk, EVENTS_MODULE_CODE):
        raise PermissionDenied("Events are not enabled for this Site.")
    require_events_module(site)
    return site


class SiteEventCategories(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    serializer_class = EventCategorySerializer

    @extend_schema(tags=["Events"], responses={200: EventCategorySerializer(many=True)})
    def get(self, request, site_pk):
        site = _site_with_events(site_pk)
        _require_site_admin(request.user, site)
        rows = Category.objects.filter(site_id=site.pk, kind=Category.Kind.EVENTS)
        if request.query_params.get("include_inactive") != "true":
            rows = rows.filter(is_active=True)
        return Response(EventCategorySerializer(rows.order_by("position", "name"), many=True).data)

    @extend_schema(
        operation_id="v1_sites_event_categories_create",
        tags=["Events"],
        request=EventCategorySerializer,
        responses={201: EventCategorySerializer},
    )
    def post(self, request, site_pk):
        site = _site_with_events(site_pk)
        _require_site_admin(request.user, site)
        serializer = EventCategorySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not serializer.validated_data.get("code"):
            slug = serializer.validated_data["slug"]
            serializer.validated_data["code"] = ("EVT_" + slug.upper().replace("-", "_"))[:64]
        try:
            category = Category(
                site=site, kind=Category.Kind.EVENTS,
                created_by=request.user, updated_by=request.user,
                **serializer.validated_data,
            )
            category.full_clean()
            category.save()
        except (IntegrityError, ValidationError) as error:
            raise serializers.ValidationError({
                "slug": "An active category with this slug already exists in this Site and language.",
            }) from error
        return Response(EventCategorySerializer(category).data, status=201)

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store, max-age=0"
        response["Vary"] = "Authorization, Cookie, Host"
        return response


class SiteEventCategoryDetail(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    serializer_class = EventCategorySerializer

    @extend_schema(tags=["Events"], request=EventCategorySerializer, responses={200: EventCategorySerializer})
    def patch(self, request, site_pk, category_id):
        return self._update(request, site_pk, category_id, partial=True)

    @extend_schema(tags=["Events"], request=EventCategorySerializer, responses={200: EventCategorySerializer})
    def put(self, request, site_pk, category_id):
        return self._update(request, site_pk, category_id, partial=False)

    def _update(self, request, site_pk, category_id, *, partial):
        site = _site_with_events(site_pk)
        _require_site_admin(request.user, site)
        category = get_object_or_404(
            Category, pk=category_id, site_id=site.pk, kind=Category.Kind.EVENTS,
        )
        serializer = EventCategorySerializer(category, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        for field, value in serializer.validated_data.items():
            setattr(category, field, value)
        category.updated_by = request.user
        try:
            category.full_clean()
            category.save()
        except (IntegrityError, ValidationError) as error:
            raise serializers.ValidationError({
                "slug": "An active category with this slug already exists in this Site and language.",
            }) from error
        return Response(EventCategorySerializer(category).data)

    @extend_schema(tags=["Events"], responses={204: None})
    def delete(self, request, site_pk, category_id):
        site = _site_with_events(site_pk)
        _require_site_admin(request.user, site)
        category = get_object_or_404(
            Category, pk=category_id, site_id=site.pk, kind=Category.Kind.EVENTS,
        )
        category.is_active = False
        category.updated_by = request.user
        category.save(update_fields=["is_active", "updated_by", "updated_at"])
        return Response(status=204)

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store, max-age=0"
        response["Vary"] = "Authorization, Cookie, Host"
        return response
