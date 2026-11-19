"""Authenticated Site-scoped homepage template catalogue and application."""
from django.core.exceptions import ValidationError as DomainValidationError
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.db import IntegrityError, transaction
from django.utils.text import slugify
from rest_framework.views import APIView
from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.sites.api.access import Conflict
from apps.sites.api.serializers import StrictFields
from apps.sites.models import Site
from ..authorization import require_cms_grant
from ..models import ContentRole
from ..models import ContentStatus, Page
from ..services.working_drafts import content_etag
from ..homepage_templates import catalogue, prepare_template
from ..layout_contract import validate_layout, validate_layout_media
from ..models import Visibility
from apps.organizations.hierarchy_lock import hierarchy_write
from .pages import SITE_PARAMETER, PageSerializer, ensure_pages_module_enabled, ensure_visual_builder_module_enabled
from .visual_drafts import VisualLayoutField


class HomepageTemplateOutput(serializers.Serializer):
    manifest_version = serializers.IntegerField()
    id = serializers.CharField()
    version = serializers.IntegerField()
    name = serializers.CharField()
    description = serializers.CharField()
    required_modules = serializers.ListField(child=serializers.CharField())
    layout = VisualLayoutField(allow_null=True)
    available = serializers.BooleanField()
    unavailable_reasons = serializers.ListField(child=serializers.CharField())


class PrepareInput(StrictFields, serializers.Serializer):
    template_id = serializers.SlugField(max_length=80)
    version = serializers.IntegerField(min_value=1)


class PrepareOutput(serializers.Serializer):
    template_id = serializers.CharField()
    template_version = serializers.IntegerField()
    visual_layout = VisualLayoutField()


class ApplyInput(StrictFields, serializers.Serializer):
    template_id = serializers.SlugField(max_length=80)
    version = serializers.IntegerField(min_value=1)
    mode = serializers.ChoiceField(choices=("new", "replace"))
    title = serializers.CharField(max_length=255, required=False, allow_blank=False)
    slug = serializers.SlugField(max_length=180, required=False)
    page_id = serializers.UUIDField(required=False)

    def validate(self, attrs):
        if attrs["mode"] == "new" and "page_id" in attrs:
            raise serializers.ValidationError({"page_id": "Choose a new draft or replacement, not both."})
        if attrs["mode"] == "replace" and "page_id" not in attrs:
            raise serializers.ValidationError({"page_id": "Select an editable draft to replace."})
        return attrs


class HomepageTemplateCatalogue(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    def authorize(self, request, site_pk):
        site = get_object_or_404(Site, pk=site_pk)
        require_cms_grant(request.user, site.pk, (ContentRole.AUTHOR,), request=request)
        if request.query_params:
            raise ValidationError({"query": "This endpoint accepts no query parameters."})
        return site

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        response["Vary"] = "Authorization, Cookie"
        response["X-Robots-Tag"] = "noindex, nofollow"
        return response

    @extend_schema(tags=["Homepage templates"], parameters=[SITE_PARAMETER], responses=HomepageTemplateOutput(many=True))
    def get(self, request, site_pk):
        site = self.authorize(request, site_pk)
        return Response(HomepageTemplateOutput(catalogue(site.pk), many=True).data)


class HomepageTemplatePrepare(HomepageTemplateCatalogue):
    http_method_names = ["post", "options"]

    @extend_schema(tags=["Homepage templates"], parameters=[SITE_PARAMETER], request=PrepareInput, responses=PrepareOutput,
                   description="Prepare a fresh validated builder document. Does not create/save/publish a Page or assign a homepage. Save through the existing concurrency-checked Page visual-draft API.")
    def post(self, request, site_pk):
        site = self.authorize(request, site_pk)
        payload = PrepareInput(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            result = prepare_template(site.pk, payload.validated_data["template_id"], payload.validated_data["version"])
        except DomainValidationError as error:
            raise ValidationError(error.message_dict) from error
        return Response(PrepareOutput(result).data)


class HomepageTemplateApply(HomepageTemplateCatalogue):
    http_method_names = ["post", "options"]

    @extend_schema(tags=["Homepage templates"], parameters=[SITE_PARAMETER], request=ApplyInput,
                   responses={201: PageSerializer, 200: PageSerializer},
                   description="Apply an approved template atomically to a new Page draft or an explicitly selected editable draft. Preserves the published homepage and records template provenance in Page metadata and revision history. Idempotency-Key replays the same created draft.")
    def post(self, request, site_pk):
        site = self.authorize(request, site_pk)
        ensure_pages_module_enabled(site.pk)
        ensure_visual_builder_module_enabled(site.pk)
        payload = ApplyInput(data=request.data)
        payload.is_valid(raise_exception=True)
        values = payload.validated_data
        try:
            template = prepare_template(site.pk, values["template_id"], values["version"])
            layout = validate_layout(template["visual_layout"])
            validate_layout_media(layout, site_id=site.pk)
        except DomainValidationError as error:
            raise ValidationError(error.message_dict) from error
        template["visual_layout"] = layout
        key = request.headers.get("Idempotency-Key")
        if values["mode"] == "new" and (not key or len(key) > 128):
            raise ValidationError({"Idempotency-Key": "A bounded idempotency key is required for a new draft."})
        try:
            with transaction.atomic():
                # Serialize applications across editors, then lock the target Page.
                # This also makes same-key retries deterministic.
                with hierarchy_write():
                    return self._apply_locked(request, site, values, template, key)
        except IntegrityError as error:
            # Kept outside the failed transaction so uniqueness races return the
            # same conflict contract as ordinary Page creation.
            raise Conflict() from error

    def _apply_locked(self, request, site, values, template, key):
        from apps.sites.api.access import PreconditionRequired
        from .pages import PageEditConflict
        if values["mode"] == "new":
            existing = Page.objects.select_for_update().filter(
                site=site, metadata__template_application__idempotency_key=key,
            ).first()
            if existing:
                response = Response(PageSerializer(existing, context={"request": request, "site": site}).data)
                response["ETag"] = content_etag(existing)
                return response
            title = values.get("title") or template["template_id"].replace("-", " ").title()
            slug = values.get("slug") or slugify(title)
            if not slug:
                raise ValidationError({"slug": "Provide a usable Page title or slug."})
            application = {"id": values["template_id"], "version": values["version"], "idempotency_key": key}
            metadata = {"visual_layout": template["visual_layout"], "template_application": application}
            serializer = PageSerializer(data={"title": title, "slug": slug, "visibility": Visibility.PUBLIC,
                "blocks": [], "metadata": metadata}, context={"request": request, "site": site})
            serializer.is_valid(raise_exception=True)
            page = serializer.save(site=site, created_by=request.user, updated_by=request.user)
            response = Response(PageSerializer(page, context={"request": request, "site": site}).data, status=201)
            response["ETag"] = content_etag(page)
            return response

        page = Page.objects.select_for_update().filter(site=site, pk=values["page_id"]).first()
        if page is None:
            from django.http import Http404
            raise Http404
        if page.status not in {ContentStatus.DRAFT, ContentStatus.UNPUBLISHED} or page.is_homepage or site.homepage_id == page.pk:
            raise ValidationError({"page_id": "Only an eligible, unpublished working draft can be replaced."})
        supplied = request.headers.get("If-Match")
        if not supplied:
            raise PreconditionRequired()
        if supplied != content_etag(page):
            raise PageEditConflict("The draft changed. Reload it before applying a template.")
        page.metadata = {**page.metadata, "visual_layout": template["visual_layout"],
            "template_application": {"id": values["template_id"], "version": values["version"]}}
        page.blocks = []
        page.updated_by = request.user
        page.save(update_fields={"metadata", "blocks", "updated_by"})
        response = Response(PageSerializer(page, context={"request": request, "site": site}).data)
        response["ETag"] = content_etag(page)
        return response
