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
from ..models import ContentRole, Document
from ..services.document_access import DocumentFileThrottle
from apps.api.models import Category
from apps.audit.writer import record_event
from ..services.workflow import transition_content


class DocumentCategorySerializer(serializers.ModelSerializer):
    code = serializers.CharField(required=False, max_length=64)
    slug = serializers.SlugField(required=False, allow_blank=True, max_length=128)
    class Meta:
        model = Category
        fields = ("id", "code", "name", "slug", "description", "position", "is_active", "locale", "created_at", "updated_at")
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
            raise serializers.ValidationError({"name": "Use a category name containing letters or numbers."})
        return attrs


class DocumentSerializer(serializers.ModelSerializer):
    slug = serializers.SlugField(required=False, allow_blank=True, max_length=255)
    visible_to_public = serializers.BooleanField(required=False)
    require_login_to_download = serializers.BooleanField(required=False)
    categories = serializers.PrimaryKeyRelatedField(queryset=Category.objects.none(), many=True, required=False)
    categories_detail = DocumentCategorySerializer(source="categories", many=True, read_only=True)
    creator = serializers.IntegerField(source="created_by_id", read_only=True)
    file_type = serializers.SerializerMethodField()
    original_filename = serializers.SerializerMethodField()
    file_size = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = ("id", "site", "title", "slug", "description", "file_reference", "file_type", "original_filename", "file_size", "categories", "categories_detail", "status", "creator", "created_at", "updated_at", "revision_number", "published_at", "version", "effective_date", "visibility", "visible_to_public", "require_login_to_download")
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
        fields["categories"].child_relation.queryset = Category.objects.filter(site_id=site_id, is_active=True, kind=Category.Kind.DOCUMENTS)
        return fields

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a document title.")
        return value

    def validate_version(self, value):
        return value.strip()

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
        if "visible_to_public" in attrs:
            attrs["visibility"] = "PUBLIC" if attrs["visible_to_public"] else "HIDDEN"
        elif "visibility" in attrs:
            attrs["visible_to_public"] = attrs["visibility"] == "PUBLIC"
        for category in attrs.get("categories", []):
            if category.site_id != site_id or not category.is_active or category.kind != Category.Kind.DOCUMENTS:
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


def _document_audit_snapshot(document):
    return {
        "site_id": document.site_id,
        "title": document.title,
        "slug": document.slug,
        "description": document.description,
        "version": document.version,
        "effective_date": document.effective_date.isoformat() if document.effective_date else None,
        "visibility": document.visibility,
        "visible_to_public": document.visible_to_public,
        "require_login_to_download": document.require_login_to_download,
        "status": document.status,
        "categories": sorted(str(value) for value in document.categories.values_list("pk", flat=True)),
        "revision_number": document.revision_number,
    }


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
        after = _document_audit_snapshot(document)
        record_event(action="DOCUMENT_CREATED", entity_type="cms.document", entity_id=document.pk,
                     after=after, changed_fields=after.keys())
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
        before = _document_audit_snapshot(obj)
        serializer = DocumentSerializer(obj, data=request.data, partial=True, context={"request": request, "site_id": obj.site_id})
        serializer.is_valid(raise_exception=True)
        try:
            obj = serializer.save()
        except ValidationError as error:
            raise serializers.ValidationError(error.message_dict if hasattr(error, "message_dict") else error.messages) from error
        after = _document_audit_snapshot(obj)
        changed = [field for field in after if before.get(field) != after[field]]
        if changed:
            record_event(action="DOCUMENT_UPDATED", entity_type="cms.document", entity_id=obj.pk,
                         before=before, after=after, changed_fields=changed)
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


class SiteDocumentFilePreview(APIView):
    """RBAC-protected preview/download for Site document managers."""
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [DocumentFileThrottle]
    http_method_names = ["get", "head", "options"]

    @extend_schema(
        tags=["CMS documents"],
        responses={
            (200, "application/octet-stream"): {"type": "string", "format": "binary"},
            401: None,
            403: None,
            404: None,
        },
        description=(
            "Stream a Site-owned document after bearer authentication, Site CMS "
            "role, module, publication/visibility, eligibility, and ready-file "
            "checks. Responses are private and no-store; storage keys are never "
            "returned. PDF may be inline; other supported files are attachments."
        ),
    )
    def get(self, request, site_pk, document_id):
        site = get_object_or_404(Site, pk=site_pk)
        from ..services.document_access import authorize_document_file, document_file_response
        document, asset, bucket, key = authorize_document_file(
            document_id=document_id, site=site, user=request.user, request=request, management=True,
        )
        return document_file_response(
            request=request, document=document, asset=asset, bucket=bucket, key=key,
        )

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store, max-age=0"
        response["Vary"] = "Authorization, Cookie, Host"
        return response

class SiteDocumentCategories(APIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    serializer_class = DocumentCategorySerializer
    @extend_schema(tags=["CMS documents"], responses={200: DocumentCategorySerializer(many=True)})
    def get(self, request, site_pk, category_id=None):
        site = get_object_or_404(Site, pk=site_pk)
        if not module_is_available(site.pk, "DOCUMENTS"):
            raise NotFound("Documents are not enabled for this Site.")
        require_cms_grant(request.user, site.pk, tuple(ContentRole.values), request=request)
        rows = Category.objects.filter(site_id=site.pk, kind=Category.Kind.DOCUMENTS)
        if category_id:
            return Response(DocumentCategorySerializer(get_object_or_404(rows, pk=category_id)).data)
        if request.query_params.get("include_inactive") != "true":
            rows = rows.filter(is_active=True)
        return Response(DocumentCategorySerializer(rows.order_by("position", "name"), many=True).data)

    @extend_schema(tags=["CMS documents"], request=DocumentCategorySerializer, responses={201: DocumentCategorySerializer})
    def post(self, request, site_pk):
        site = get_object_or_404(Site, pk=site_pk)
        if not module_is_available(site.pk, "DOCUMENTS"):
            raise NotFound("Documents are not enabled for this Site.")
        if not cms_administrator_allows(request.user, site.pk):
            raise PermissionDenied("A Site Administrator is required to manage document categories.")
        serializer = DocumentCategorySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not serializer.validated_data.get("code"):
            serializer.validated_data["code"] = "DOC_" + serializer.validated_data["slug"].upper().replace("-", "_")[:59]
        try:
            category = Category(site=site, kind=Category.Kind.DOCUMENTS, created_by=request.user, updated_by=request.user, **serializer.validated_data)
            category.full_clean()
            category.save()
        except (IntegrityError, ValidationError) as error:
            raise serializers.ValidationError({"slug": "An active category with this slug already exists in this Site and language."}) from error
        return Response(DocumentCategorySerializer(category).data, status=201)

    @extend_schema(tags=["CMS documents"], request=DocumentCategorySerializer, responses={200: DocumentCategorySerializer})
    def patch(self, request, site_pk, category_id):
        return self._update(request, site_pk, category_id, partial=True)

    @extend_schema(tags=["CMS documents"], request=DocumentCategorySerializer, responses={200: DocumentCategorySerializer})
    def put(self, request, site_pk, category_id):
        return self._update(request, site_pk, category_id, partial=False)

    def _update(self, request, site_pk, category_id, *, partial):
        site = get_object_or_404(Site, pk=site_pk)
        if not module_is_available(site.pk, "DOCUMENTS"):
            raise NotFound("Documents are not enabled for this Site.")
        if not cms_administrator_allows(request.user, site.pk):
            raise PermissionDenied("A Site Administrator is required to manage document categories.")
        category = get_object_or_404(Category, pk=category_id, site_id=site.pk, kind=Category.Kind.DOCUMENTS)
        serializer = DocumentCategorySerializer(category, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        for field, value in serializer.validated_data.items():
            setattr(category, field, value)
        category.updated_by = request.user
        try:
            category.full_clean()
            category.save()
        except (IntegrityError, ValidationError) as error:
            raise serializers.ValidationError({"slug": "An active category with this slug already exists in this Site and language."}) from error
        return Response(DocumentCategorySerializer(category).data)

    @extend_schema(tags=["CMS documents"], responses={204: None})
    def delete(self, request, site_pk, category_id):
        site = get_object_or_404(Site, pk=site_pk)
        if not module_is_available(site.pk, "DOCUMENTS"):
            raise NotFound("Documents are not enabled for this Site.")
        if not cms_administrator_allows(request.user, site.pk):
            raise PermissionDenied("A Site Administrator is required to delete document categories.")
        category = get_object_or_404(Category, pk=category_id, site_id=site.pk, kind=Category.Kind.DOCUMENTS)
        if category.documents.exists():
            raise serializers.ValidationError({"detail": "This category is assigned to documents. Deactivate it to retain those associations."})
        category.delete()
        return Response(status=204)
