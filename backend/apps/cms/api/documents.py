"""Site-scoped document authoring API."""
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import NotFound
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import JSONParser, FormParser, MultiPartParser
from drf_spectacular.utils import OpenApiParameter, extend_schema

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.sites.models import Site
from apps.sites.selectors.modules import module_is_available
from ..authorization import require_cms_grant, cms_administrator_allows
from ..models import ContentRole, Document, DocumentCategory
from ..services.workflow import transition_content


class DocumentCategorySerializer(serializers.ModelSerializer):
    slug = serializers.SlugField(required=False, allow_blank=True, max_length=128)
    class Meta:
        model = DocumentCategory
        fields = ("id", "name", "slug")
        read_only_fields = ("id",)

    def validate_name(self, value):
        if not value.strip():
            raise serializers.ValidationError("Enter a category name.")
        return value.strip()

    def validate(self, attrs):
        if not attrs.get("slug"):
            from django.utils.text import slugify
            attrs["slug"] = slugify(attrs.get("name", ""))[:128]
        if not attrs.get("slug"):
            raise serializers.ValidationError({"name": "Use a category name containing letters or numbers."})
        return attrs


class DocumentSerializer(serializers.ModelSerializer):
    slug = serializers.SlugField(required=False, allow_blank=True, max_length=255)
    categories = serializers.PrimaryKeyRelatedField(queryset=DocumentCategory.objects.none(), many=True, required=False)
    categories_detail = DocumentCategorySerializer(source="categories", many=True, read_only=True)
    creator = serializers.IntegerField(source="created_by_id", read_only=True)
    file_type = serializers.SerializerMethodField()
    original_filename = serializers.SerializerMethodField()
    file_size = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = ("id", "site", "title", "slug", "description", "file_reference", "file_type", "original_filename", "file_size", "categories", "categories_detail", "status", "creator", "created_at", "updated_at", "revision_number", "published_at", "version", "effective_date", "visibility")
        read_only_fields = ("id", "site", "status", "creator", "created_at", "updated_at", "revision_number", "published_at", "categories_detail")

    def get_file_type(self, obj):
        return self._asset(obj).detected_mime

    def get_original_filename(self, obj):
        return self._asset(obj).original_filename

    def get_file_size(self, obj):
        return self._asset(obj).byte_count

    def _asset(self, obj):
        from apps.media.document_references import validate_document_file
        cache = self.context.setdefault("document_asset_cache", {})
        if obj.pk not in cache:
            cache[obj.pk] = validate_document_file(obj.file_reference, obj.site_id)
        return cache[obj.pk]

    def get_fields(self):
        fields = super().get_fields()
        site_id = self.context.get("site_id")
        fields["categories"].child_relation.queryset = DocumentCategory.objects.filter(site_id=site_id, is_active=True)
        return fields

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a document title.")
        return value

    def validate_file_reference(self, value):
        from apps.media.document_references import validate_document_file
        site_id = getattr(self.instance, "site_id", None) or self.context.get("site_id")
        try:
            validate_document_file(value, site_id)
        except ValidationError as error:
            raise serializers.ValidationError(error.message_dict if hasattr(error, "message_dict") else error.messages) from error
        return value

    def validate(self, attrs):
        instance = self.instance
        site_id = getattr(instance, "site_id", None) or self.context.get("site_id")
        for category in attrs.get("categories", []):
            if category.site_id != site_id or not category.is_active:
                raise serializers.ValidationError({"categories": "Choose active categories belonging to this Site."})
        if not instance:
            attrs.setdefault("created_by", self.context["request"].user)
        attrs["updated_by"] = self.context["request"].user
        if not attrs.get("slug") and not instance:
            from django.utils.text import slugify
            attrs["slug"] = slugify(attrs.get("title", ""))[:255]
        slug = attrs.get("slug", getattr(instance, "slug", ""))
        if slug and Document.objects.filter(site_id=site_id, slug=slug).exclude(pk=getattr(instance, "pk", None)).exists():
            raise serializers.ValidationError({"slug": "A document with this slug already exists in this Site."})
        return attrs

    def create(self, validated_data):
        categories = validated_data.pop("categories", [])
        document = Document(site_id=self.context["site_id"], **validated_data)
        document._pending_categories = categories
        document.save()
        return document

    def update(self, instance, validated_data):
        categories = validated_data.pop("categories", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        if categories is not None:
            instance._pending_categories = categories
        instance.save()
        return instance


class DocumentPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class DocumentListResponse(serializers.Serializer):
    count = serializers.IntegerField()
    next = serializers.URLField(allow_null=True)
    previous = serializers.URLField(allow_null=True)
    results = DocumentSerializer(many=True)


class SiteDocuments(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, FormParser, MultiPartParser]

    def site(self, request, site_pk):
        site = get_object_or_404(Site, pk=site_pk)
        if not module_is_available(site.pk, "DOCUMENTS"):
            raise NotFound("Documents are not enabled for this Site.")
        return site

    def grant(self, request, site, write=False, delete=False, publish=False):
        roles = (ContentRole.AUTHOR,) if write or delete else tuple(ContentRole.values)
        require_cms_grant(request.user, site.pk, roles, request=request)

    @extend_schema(tags=["CMS documents"], responses={200: DocumentListResponse}, parameters=[
        OpenApiParameter("search", str, description="Case-insensitive document title search."),
        OpenApiParameter("category", str, description="Site document category UUID."),
        OpenApiParameter("status", str, enum=["DRAFT","IN_REVIEW","APPROVED","PUBLISHED","UNPUBLISHED","ARCHIVED"]),
        OpenApiParameter("file_type", str, description="Detected MIME type."),
        OpenApiParameter("visibility", str, enum=["PUBLIC","UNLISTED","HIDDEN"]),
        OpenApiParameter("page", int), OpenApiParameter("page_size", int),
    ])
    def get(self, request, site_pk, document_id=None):
        site = self.site(request, site_pk)
        self.grant(request, site)
        if document_id:
            document = get_object_or_404(Document, pk=document_id, site_id=site.pk)
            return Response(DocumentSerializer(document, context={"site_id": site.pk}).data)
        rows = Document.objects.filter(site_id=site.pk).select_related("site").prefetch_related("categories")
        search = request.query_params.get("search", "").strip()
        category = request.query_params.get("category")
        status = request.query_params.get("status")
        file_type = request.query_params.get("file_type")
        visibility = request.query_params.get("visibility")
        if search: rows = rows.filter(Q(title__icontains=search))
        if category: rows = rows.filter(categories__pk=category)
        if status: rows = rows.filter(status=status)
        if visibility: rows = rows.filter(visibility=visibility)
        if file_type:
            from apps.media.models import MediaAsset
            asset_ids = MediaAsset.objects.filter(site_id=site.pk, detected_mime=file_type).values_list("pk", flat=True)
            rows = rows.filter(file_reference__in=[f"sites/{site.pk}/assets/{asset_id}" for asset_id in asset_ids])
        rows = rows.distinct().order_by("-updated_at", "id")
        paginator = DocumentPagination()
        page = paginator.paginate_queryset(rows, request, view=self)
        return paginator.get_paginated_response(DocumentSerializer(page, many=True, context={"site_id": site.pk}).data)

    @extend_schema(tags=["CMS documents"], request=DocumentSerializer, responses={201: DocumentSerializer})
    @transaction.atomic
    def post(self, request, site_pk):
        site = self.site(request, site_pk)
        self.grant(request, site, write=True)
        serializer = DocumentSerializer(data=request.data, context={"request": request, "site_id": site.pk})
        serializer.is_valid(raise_exception=True)
        try:
            document = serializer.save()
        except ValidationError as error:
            raise serializers.ValidationError(error.message_dict if hasattr(error, "message_dict") else error.messages) from error
        return Response(DocumentSerializer(document, context={"site_id": site.pk}).data, status=201)


class SiteDocumentDetail(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]

    def _record(self, request, site_pk, document_id, write=False):
        site = get_object_or_404(Site, pk=site_pk)
        if not module_is_available(site.pk, "DOCUMENTS"):
            raise NotFound("Documents are not enabled for this Site.")
        require_cms_grant(request.user, site.pk, (ContentRole.AUTHOR,) if write else tuple(ContentRole.values), request=request)
        return get_object_or_404(Document, pk=document_id, site_id=site.pk)

    @extend_schema(tags=["CMS documents"], responses={200: DocumentSerializer})
    def get(self, request, site_pk, document_id):
        obj = self._record(request, site_pk, document_id)
        return Response(DocumentSerializer(obj, context={"site_id": obj.site_id}).data)

    @extend_schema(tags=["CMS documents"], request=DocumentSerializer, responses={200: DocumentSerializer})
    @transaction.atomic
    def patch(self, request, site_pk, document_id):
        obj = self._record(request, site_pk, document_id, write=True)
        serializer = DocumentSerializer(obj, data=request.data, partial=True, context={"request": request, "site_id": obj.site_id})
        serializer.is_valid(raise_exception=True)
        try:
            obj = serializer.save()
        except ValidationError as error:
            raise serializers.ValidationError(error.message_dict if hasattr(error, "message_dict") else error.messages) from error
        return Response(DocumentSerializer(obj, context={"site_id": obj.site_id}).data)

    @extend_schema(tags=["CMS documents"], responses={204: None})
    def delete(self, request, site_pk, document_id):
        site = get_object_or_404(Site, pk=site_pk)
        if not module_is_available(site.pk, "DOCUMENTS"):
            raise NotFound("Documents are not enabled for this Site.")
        if not cms_administrator_allows(request.user, site.pk):
            raise PermissionDenied("A Site Administrator is required to delete documents.")
        obj = get_object_or_404(Document, pk=document_id, site_id=site.pk)
        obj.updated_by = request.user
        obj.delete()
        return Response(status=204)


class SiteDocumentWorkflow(SiteDocumentDetail):
    @extend_schema(tags=["CMS documents"], request=None, responses={200: DocumentSerializer})
    def post(self, request, site_pk, document_id, action):
        obj = self._record(request, site_pk, document_id)
        require_cms_grant(request.user, obj.site_id, (ContentRole.PUBLISHER,) if action in ("publish", "unpublish") else (ContentRole.AUTHOR,), request=request)
        if action not in ("publish", "unpublish"):
            return Response({"detail": "Unknown document action."}, status=404)
        transition = "publish" if action == "publish" else "unpublish"
        obj = transition_content(obj.pk, action=transition, actor=request.user, comment="Document administration")
        return Response(DocumentSerializer(obj, context={"site_id": obj.site_id}).data)


class SiteDocumentCategories(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    @extend_schema(tags=["CMS documents"], responses={200: DocumentCategorySerializer(many=True)})
    def get(self, request, site_pk):
        site = get_object_or_404(Site, pk=site_pk)
        if not module_is_available(site.pk, "DOCUMENTS"):
            raise NotFound("Documents are not enabled for this Site.")
        require_cms_grant(request.user, site.pk, tuple(ContentRole.values), request=request)
        return Response(DocumentCategorySerializer(DocumentCategory.objects.filter(site_id=site.pk, is_active=True), many=True).data)

    @extend_schema(tags=["CMS documents"], request=DocumentCategorySerializer, responses={201: DocumentCategorySerializer})
    def post(self, request, site_pk):
        site = get_object_or_404(Site, pk=site_pk)
        if not module_is_available(site.pk, "DOCUMENTS"):
            raise NotFound("Documents are not enabled for this Site.")
        require_cms_grant(request.user, site.pk, (ContentRole.AUTHOR,), request=request)
        serializer = DocumentCategorySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            category = DocumentCategory.objects.create(site=site, **serializer.validated_data)
        except IntegrityError as error:
            raise serializers.ValidationError({"slug": "A category with this slug already exists in this Site."}) from error
        return Response(DocumentCategorySerializer(category).data, status=201)
