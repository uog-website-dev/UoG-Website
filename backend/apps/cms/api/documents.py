"""Site scoped document management API."""
import hashlib
from django.core.exceptions import ValidationError as DomainValidationError
from django.db import IntegrityError
from django.shortcuts import get_object_or_404
from rest_framework import serializers, mixins
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet
from rest_framework.pagination import PageNumberPagination
from rest_framework.renderers import BaseRenderer
from django.http import HttpResponse
from django.utils.http import content_disposition_header
from django.db.models import Q
from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.sites.models import Site
from apps.sites.selectors.modules import module_is_available
from apps.cms.authorization import require_cms_grant
from apps.cms.models import Document, DocumentCategory, ContentRole, ContentStatus
from apps.cms.services.workflow import transition_content
from apps.api.document_media import validate_document_file
from apps.media.models import MediaAsset
from apps.media.storage import ObjectStorage

class DocumentFileRenderer(BaseRenderer):
    media_type = "application/octet-stream"
    format = "document"
    def render(self, data, accepted_media_type=None, renderer_context=None):
        return data if isinstance(data, bytes) else b""


class DocumentSerializer(serializers.ModelSerializer):
    categories = serializers.PrimaryKeyRelatedField(many=True, required=False, queryset=DocumentCategory.objects.filter(is_active=True))
    file_type = serializers.SerializerMethodField()
    class Meta:
        model = Document
        fields = ("id", "site", "title", "slug", "description", "file_reference", "file_type", "categories", "status", "visibility", "version", "effective_date", "published_at", "created_by", "updated_by", "created_at", "updated_at", "revision_number")
        read_only_fields = ("id", "site", "status", "published_at", "created_by", "updated_by", "created_at", "updated_at", "revision_number")
    def validate_title(self, value):
        if not value.strip(): raise serializers.ValidationError("Enter a document title.")
        return value.strip()
    def validate_description(self, value):
        from apps.cms.blocks import sanitize_rich_text
        return sanitize_rich_text(value)
    def validate_categories(self, value):
        site_id = getattr(self.context.get("site"), "pk", getattr(self.instance, "site_id", None))
        if any(category.site_id != site_id or not category.is_active for category in value):
            raise serializers.ValidationError("Choose categories belonging to this Site.")
        return value
    def validate_file_reference(self, value):
        site_id = getattr(self.context.get("site"), "pk", getattr(self.instance, "site_id", None))
        try:
            validate_document_file(value, site_id)
        except DomainValidationError as error:
            raise serializers.ValidationError(error.message_dict.get("file_reference", error.messages)) from error
        return value
    def get_file_type(self, obj):
        try: return validate_document_file(obj.file_reference, obj.site_id).detected_mime
        except DomainValidationError: return ""
    def create(self, validated_data):
        cats = validated_data.pop("categories", [])
        doc = Document(**validated_data)
        doc._pending_categories = cats
        doc.save()
        return doc
    def update(self, instance, validated_data):
        cats = validated_data.pop("categories", None)
        for key, value in validated_data.items(): setattr(instance, key, value)
        if cats is not None: instance._pending_categories = cats
        instance.save()
        return instance


class DocumentPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class DocumentListQuery(serializers.Serializer):
    search=serializers.CharField(required=False,allow_blank=True,max_length=255)
    category=serializers.UUIDField(required=False)
    status=serializers.ChoiceField(choices=ContentStatus.choices,required=False)
    file_type=serializers.ChoiceField(choices=("pdf","text"),required=False)
    visibility=serializers.ChoiceField(choices=("PUBLIC","UNLISTED","HIDDEN"),required=False)
    def to_internal_value(self,data):
        allowed=set(self.fields)|{"page","page_size"}
        errors={key:["Unknown query parameter."] for key in set(data)-allowed}
        if hasattr(data,"getlist"):
            errors.update({key:["Supply this query parameter only once."] for key in data if len(data.getlist(key))!=1})
        if errors: raise serializers.ValidationError(errors)
        return super().to_internal_value({key:value for key,value in data.items() if key in self.fields})


class DocumentCategorySerializer(serializers.ModelSerializer):
    slug = serializers.SlugField(max_length=128, required=False)
    class Meta:
        model = DocumentCategory
        fields = ("id", "site", "name", "slug", "is_active", "created_at")
        read_only_fields = ("id", "site", "created_at")
    def validate_name(self, value):
        value=value.strip()
        if not value: raise serializers.ValidationError("Enter a category name.")
        return value
    def validate(self, attrs):
        if not attrs.get("slug"):
            attrs["slug"] = __import__('django.utils.text',fromlist=['slugify']).slugify(attrs.get("name", getattr(self.instance,"name","")))
        return attrs


class SiteDocumentCategoryViewSet(mixins.ListModelMixin, mixins.CreateModelMixin,
    mixins.RetrieveModelMixin, mixins.UpdateModelMixin, GenericViewSet):
    authentication_classes=[KeycloakBearerAuthentication]
    permission_classes=[IsAuthenticated]
    serializer_class=DocumentCategorySerializer
    pagination_class=DocumentPagination
    def _site(self):
        site=get_object_or_404(Site,pk=self.kwargs["site_pk"])
        if not module_is_available(site.pk,"DOCUMENTS"):
            raise serializers.ValidationError({"reason":"module_disabled","module":"DOCUMENTS"})
        return site
    def _authorize(self,write=False):
        site=self._site()
        require_cms_grant(self.request.user,site.pk,(ContentRole.AUTHOR,) if write else ContentRole.values,request=self.request)
        return site
    def get_queryset(self): return DocumentCategory.objects.filter(site_id=self.kwargs["site_pk"])
    def list(self,request,*args,**kwargs): self._authorize(); return super().list(request,*args,**kwargs)
    def retrieve(self,request,*args,**kwargs): self._authorize(); return super().retrieve(request,*args,**kwargs)
    def create(self,request,*args,**kwargs):
        site=self._authorize(True); serializer=self.get_serializer(data=request.data); serializer.is_valid(raise_exception=True); row=serializer.save(site=site); return Response(self.get_serializer(row).data,status=201)
    def partial_update(self,request,*args,**kwargs):
        self._authorize(True); row=get_object_or_404(self.get_queryset(),pk=self.kwargs["pk"]); serializer=self.get_serializer(row,data=request.data,partial=True); serializer.is_valid(raise_exception=True); return Response(self.get_serializer(serializer.save()).data)
    def update(self,request,*args,**kwargs): return self.partial_update(request,*args,**kwargs)


class SiteDocumentViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, GenericViewSet):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]
    serializer_class = DocumentSerializer
    pagination_class = DocumentPagination
    lookup_value_regex = r"[0-9a-f-]{36}"

    def _site(self): return get_object_or_404(Site, pk=self.kwargs["site_pk"])
    def _gate(self, write=False):
        site = self._site()
        if not module_is_available(site.pk, "DOCUMENTS"):
            raise serializers.ValidationError({"reason":"module_disabled", "module":"DOCUMENTS"})
        require_cms_grant(self.request.user, site.pk, (ContentRole.AUTHOR,) if write else ContentRole.values, request=self.request)
        return site
    def get_queryset(self): return Document.objects.filter(site_id=self.kwargs["site_pk"]).prefetch_related("categories")
    def list(self, request, *args, **kwargs):
        self._gate()
        params=DocumentListQuery(data=request.query_params)
        params.is_valid(raise_exception=True)
        filters=params.validated_data
        qs=self.get_queryset()
        term=filters.get("search", "").strip()
        if term: qs=qs.filter(Q(title__icontains=term))
        for key in ("status", "visibility"):
            if key in filters: qs=qs.filter(**{key:filters[key]})
        if "file_type" in filters:
            mime={"pdf":"application/pdf","text":"text/plain"}[filters["file_type"]]
            assets=MediaAsset.objects.filter(site_id=self.kwargs["site_pk"],detected_mime=mime).values_list("pk",flat=True)
            qs=qs.filter(file_reference__in=[f"sites/{self.kwargs['site_pk']}/assets/{pk}" for pk in assets])
        if "category" in filters: qs=qs.filter(categories__pk=filters["category"])
        qs=qs.distinct()
        paginator=self.pagination_class()
        page=paginator.paginate_queryset(qs,request,view=self)
        return paginator.get_paginated_response(self.get_serializer(page,many=True).data)
    def retrieve(self, request, *args, **kwargs): self._gate(); return super().retrieve(request,*args,**kwargs)
    def create(self, request, *args, **kwargs):
        site=self._gate(write=True); s=self.get_serializer(data=request.data,context={**self.get_serializer_context(),"site":site}); s.is_valid(raise_exception=True)
        try: doc=s.save(site=site,created_by=request.user,updated_by=request.user)
        except IntegrityError as e: raise serializers.ValidationError({"slug":"A document with this slug already exists in this Site."}) from e
        return Response(self.get_serializer(doc).data,status=201)
    def partial_update(self, request, *args, **kwargs):
        site=self._gate(write=True); doc=get_object_or_404(self.get_queryset(),pk=self.kwargs["pk"]); s=self.get_serializer(doc,data=request.data,partial=True,context={**self.get_serializer_context(),"site":site}); s.is_valid(raise_exception=True); doc=s.save(updated_by=request.user); return Response(self.get_serializer(doc).data)
    def update(self, request, *args, **kwargs): return self.partial_update(request,*args,**kwargs)
    def destroy(self, request, *args, **kwargs):
        site=self._site()
        if not module_is_available(site.pk,"DOCUMENTS"): raise serializers.ValidationError({"reason":"module_disabled","module":"DOCUMENTS"})
        require_cms_grant(request.user,site.pk,(ContentRole.AUTHOR,),request=request)
        doc=get_object_or_404(self.get_queryset(),pk=self.kwargs["pk"])
        from apps.authorization.services import permission_granted
        if not permission_granted(request.user,"content.documents.delete",site_id=site.pk,request=request): raise PermissionDenied("Document deletion permission is required.")
        doc.delete()
        return Response(status=204)
    @action(detail=True,methods=["post"])
    def publish(self,request,*args,**kwargs):
        site=self._gate(write=True); doc=get_object_or_404(self.get_queryset(),pk=self.kwargs["pk"])
        require_cms_grant(request.user,site.pk,(ContentRole.PUBLISHER,),request=request)
        result=transition_content(doc.pk,action="publish",actor=request.user)
        return Response(self.get_serializer(get_object_or_404(self.get_queryset(),pk=result.pk)).data)
    @action(detail=True,methods=["post"])
    def unpublish(self,request,*args,**kwargs):
        site=self._gate(write=True); doc=get_object_or_404(self.get_queryset(),pk=self.kwargs["pk"])
        require_cms_grant(request.user,site.pk,(ContentRole.PUBLISHER,),request=request)
        result=transition_content(doc.pk,action="unpublish",actor=request.user)
        return Response(self.get_serializer(get_object_or_404(self.get_queryset(),pk=result.pk)).data)

    @action(detail=True, methods=["get"], renderer_classes=[DocumentFileRenderer])
    def preview(self, request, *args, **kwargs):
        site=self._gate()
        doc=get_object_or_404(self.get_queryset(),pk=self.kwargs["pk"])
        asset=validate_document_file(doc.file_reference, site.pk)
        try:
            bucket,key=asset.storage_reference.split(":",1)
            with ObjectStorage().open(bucket,key) as stream:
                body=stream.read(asset.byte_count+1)
        except Exception as error:
            from rest_framework.exceptions import APIException
            raise APIException("The document file is temporarily unavailable.") from error
        if len(body)!=asset.byte_count or hashlib.sha256(body).hexdigest()!=asset.checksum:
            from django.http import Http404
            raise Http404("Document unavailable.")
        response=HttpResponse(body,content_type=asset.detected_mime)
        response["Content-Disposition"]=content_disposition_header(True,asset.original_filename)
        response["Cache-Control"]="private, no-store"
        response["X-Robots-Tag"]="noindex, nofollow"
        response["X-Content-Type-Options"]="nosniff"
        response["Vary"]="Authorization, Cookie, Host"
        return response
