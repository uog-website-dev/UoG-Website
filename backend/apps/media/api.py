"""Site-scoped catalog APIs; never serve bytes or trust client-supplied MIME."""
from django.urls import path
from .delivery import image_response, ImageDeliveryMixin
from drf_spectacular.utils import extend_schema, extend_schema_field, OpenApiParameter
from rest_framework import serializers, status
from rest_framework.exceptions import ValidationError
from rest_framework.generics import GenericAPIView
from rest_framework.permissions import IsAuthenticated, BasePermission
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination

from apps.accounts.authentication import KeycloakBearerAuthentication
from apps.sites.api.access import translate_domain_errors
from apps.sites.api.serializers import StrictFields
from .models import MediaAsset, MediaAssetReference, MediaUsage, MediaCleanup
from .selectors import assets_for_site, asset_for_site, references_for_site, authorize
from .removal import remove_asset
from .services import update_asset, attach_asset, detach_reference
from .uploads import upload_asset, limits, UploadTooLarge


class AssetSerializer(serializers.ModelSerializer):
    display_name = serializers.SerializerMethodField()

    def get_display_name(self, obj) -> str:
        return obj.display_name or obj.original_filename

    processing_state = serializers.SerializerMethodField()
    content_type = serializers.CharField(source="detected_mime", read_only=True)
    thumbnail_status = serializers.SerializerMethodField()
    thumbnail_url = serializers.SerializerMethodField()
    processing_attempts = serializers.SerializerMethodField()
    processing_error_code = serializers.SerializerMethodField()

    def get_thumbnail_url(self, obj) -> str | None:
        if obj.status == "READY" and obj.detected_mime.startswith("image/") and self.get_thumbnail_status(obj) in {"READY", "NOT_GENERATED"}:
            return f"/api/v1/sites/{obj.site_id}/assets/{obj.pk}/image/?variant=thumbnail"
        return None

    def get_processing_attempts(self, obj) -> int:
        job = getattr(obj, "processing", None)
        return job.attempts if job else 0

    def get_processing_error_code(self, obj) -> str:
        job = getattr(obj, "processing", None)
        return job.failure_code if job else ""


    @extend_schema_field({"type": "string", "enum": ["NOT_GENERATED", "NOT_APPLICABLE", "PROCESSING", "READY", "FAILED", "UNAVAILABLE"]})
    def get_thumbnail_status(self, obj):
        if not obj.detected_mime.startswith("image/"):
            return "NOT_APPLICABLE"
        if obj.status == "ARCHIVED":
            return "UNAVAILABLE"
        job = getattr(obj, "processing", None)
        if obj.status == "REJECTED" or (job and job.state == "FAILED"):
            return "FAILED"
        if job:
            return "READY" if job.state == "READY" else "PROCESSING"
        return "NOT_GENERATED"

    def get_processing_state(self, obj) -> str:
        job = getattr(obj, "processing", None)
        if job and job.state == "FAILED":
            return "FAILED"
        return "PROCESSING" if obj.status == "PENDING" or (job and job.state in {"QUEUED", "PROCESSING", "RETRY"} and obj.status == "READY") else obj.status

    class Meta:
        model = MediaAsset
        fields = ("id", "site", "processing_state", "content_type", "thumbnail_status", "thumbnail_url", "processing_attempts", "processing_error_code", "original_filename", "display_name", "categories", "detected_mime", "byte_count", "checksum", "status", "width", "height", "alt_text", "created_by", "updated_by", "created_at", "updated_at")
        read_only_fields = fields


class MetadataInput(StrictFields, serializers.Serializer):
    display_name = serializers.CharField(max_length=255, required=False, allow_blank=False)
    categories = serializers.ListField(child=serializers.CharField(max_length=64, allow_blank=False), max_length=10, required=False)
    alt_text = serializers.CharField(max_length=1000, required=False, allow_blank=True)
    status = serializers.ChoiceField(choices=MediaAsset.Status.choices, required=False)


class ReferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = MediaAssetReference
        fields = ("id", "site", "asset", "page_revision", "node_id", "field_path", "repeater_item_id", "created_by", "created_at")
        read_only_fields = fields


class ReferenceInput(StrictFields, serializers.Serializer):
    asset_id = serializers.UUIDField()
    page_revision_id = serializers.IntegerField(min_value=1)
    node_id = serializers.CharField(max_length=128)
    field_path = serializers.CharField(max_length=256)
    repeater_item_id = serializers.CharField(max_length=128, required=False, default="", allow_blank=True)


class MediaView(GenericAPIView):
    authentication_classes = [KeycloakBearerAuthentication]
    permission_classes = [IsAuthenticated]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        return response


class CanUpload(BasePermission):
    def has_permission(self, request, view):
        # DRF initial() evaluates this before the raw request stream is read.
        authorize(request.user, view.kwargs["site_pk"], "content.media.upload")
        from apps.sites.models import Site
        from django.core.exceptions import PermissionDenied
        if Site.objects.filter(pk=view.kwargs["site_pk"], status="ARCHIVED").exists():
            raise PermissionDenied("Archived Sites cannot upload media.")
        return True


class AssetUpload(MediaView):
    permission_classes = [IsAuthenticated, CanUpload]
    serializer_class = AssetSerializer

    @extend_schema(tags=["Media"], parameters=[
        OpenApiParameter("Idempotency-Key", str, OpenApiParameter.HEADER, required=True, description="Client-generated UUID, retained across retries of this logical upload."),
        OpenApiParameter("Content-Length", int, OpenApiParameter.HEADER, required=True, description="Exact file byte length. The stream is also bounded independently while reading."),
        OpenApiParameter("filename", str, required=True, description="Original filename only; object keys are allocated server-side."),
    ], request={"application/octet-stream": {"type": "string", "format": "binary"}},
        responses={202: AssetSerializer}, description="Raw bounded file stream. Requires Site content.media.upload and effective MEDIA before reading bytes. Byte detection overrides Content-Type. PNG/JPEG/WebP, passive PDF and UTF-8 plain text only. Returns id, status and processing_state; PENDING/PROCESSING is never selectable. Replays return the same asset. No object paths or public URLs are accepted or returned.")
    def post(self, request, site_pk):
        if set(request.query_params) != {"filename"}:
            raise ValidationError("Only the filename query parameter is accepted.")
        length = request.META.get("CONTENT_LENGTH")
        if not length or not length.isdigit():
            raise ValidationError("A valid Content-Length is required.")
        from django.conf import settings
        if int(length) > settings.MEDIA_UPLOAD_MAX_BYTES:
            raise UploadTooLarge()
        with translate_domain_errors():
            row = upload_asset(request.user, site_pk, request.stream,
                filename=request.query_params["filename"], request_key=request.headers.get("Idempotency-Key"), expected_length=int(length))
        row.refresh_from_db()
        return Response(AssetSerializer(row).data, status=202)


class UploadPolicy(MediaView):
    serializer_class = AssetSerializer

    @extend_schema(tags=["Media"], responses={200: {"type": "object", "additionalProperties": True}}, description="Authorized Site upload types, byte and image pixel limits.")
    def get(self, request, site_pk):
        authorize(request.user, site_pk, "content.media.upload")
        return Response(limits())


class AssetQuery(StrictFields, serializers.Serializer):
    search = serializers.CharField(max_length=255, required=False, allow_blank=True, help_text="Case-insensitive literal media-name or original-filename substring.")
    status = serializers.ChoiceField(choices=MediaAsset.Status.choices, required=False)
    type = serializers.ChoiceField(choices=["image", "document"], required=False, help_text="image: image/*; document: PDF or plain text.")
    content_type = serializers.RegexField(r"\A[a-z0-9.+-]+/[a-z0-9.+-]+\Z", max_length=127, required=False, help_text="Exact detected MIME, never a filename extension or client upload header.")
    ready_images = serializers.BooleanField(required=False, default=False, help_text="READY PNG/JPEG/WebP only, filtered before pagination. Shared by Image, Slider and Gallery pickers.")
    ordering = serializers.ChoiceField(choices=["created_at", "-created_at", "original_filename", "-original_filename"], default="-created_at", required=False, help_text="Always followed by ascending asset UUID as a stable tie-breaker.")
    page = serializers.IntegerField(min_value=1, default=1, required=False)
    page_size = serializers.IntegerField(min_value=1, max_value=100, default=20, required=False)

    def validate(self, attrs):
        if attrs.get("ready_images"):
            from .selectors import READY_IMAGE_TYPES
            if attrs.get("status", "READY") != "READY" or attrs.get("type", "image") != "image" or attrs.get("content_type", "image/png") not in READY_IMAGE_TYPES:
                raise serializers.ValidationError("ready_images cannot be combined with a non-ready status or non-supported image type.")
        return attrs


class AssetPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class AssetList(MediaView):
    serializer_class = AssetSerializer
    pagination_class = AssetPagination

    @extend_schema(tags=["Media"], parameters=[AssetQuery], responses=AssetSerializer(many=True), description="Requires Site media permission and enabled MEDIA. Every filter is applied inside the owning Site before pagination. Default page size 20, max 100; default order -created_at,id. Literal case-insensitive media-name or original-filename search. Unknown/repeated filters and contradictory ready-image filters return 400. Image/Slider/Gallery controls must use ready_images=true.")
    def get(self, request, site_pk):
        authorize(request.user, site_pk)
        if any(len(request.query_params.getlist(key)) != 1 for key in request.query_params):
            raise ValidationError("Repeated query parameters are not supported.")
        query = AssetQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        filters = {key: value for key, value in query.validated_data.items() if key not in {"page", "page_size"}}
        page = self.paginate_queryset(assets_for_site(request.user, site_pk, **filters))
        return self.get_paginated_response(AssetSerializer(page, many=True).data)



class DeletionSerializer(serializers.Serializer):
    asset_id=serializers.UUIDField(read_only=True)
    state=serializers.ChoiceField(choices=["QUEUED","RETRY","DONE"],read_only=True)
    attempts=serializers.IntegerField(read_only=True)
    deleted_at=serializers.DateTimeField(read_only=True)


def deletion_data(asset,job):
    return {"asset_id":asset.pk,"state":job.state,"attempts":job.attempts,"deleted_at":asset.deleted_at}



class AssetDetail(MediaView):
    serializer_class = AssetSerializer

    @extend_schema(tags=["Media"], responses=AssetSerializer)
    def get(self, request, site_pk, asset_id):
        return Response(AssetSerializer(asset_for_site(request.user, site_pk, asset_id)).data)

    @extend_schema(tags=["Media"], request=MetadataInput, responses=AssetSerializer, description="Only display_name/categories/alt_text/status are editable. Uploaded PENDING assets are worker-controlled; trusted legacy PENDING assets may become READY or REJECTED; READY may become ARCHIVED; ARCHIVED may become READY. REJECTED is terminal. Identity and ownership cannot change.")
    def patch(self, request, site_pk, asset_id):
        data = MetadataInput(data=request.data)
        data.is_valid(raise_exception=True)
        with translate_domain_errors():
            row = update_asset(request.user, site_pk, asset_id, changes=data.validated_data)
        return Response(AssetSerializer(row).data)


    @extend_schema(tags=["Media"],request={"type":"object","additionalProperties":False},responses={202:DeletionSerializer},description="Accept removal only when no draft, live publication or explicit placement references remain. Serializes with linking, immediately hides the asset and queues idempotent post-commit object cleanup. Retains an immutable identity tombstone; repeat DELETE returns the same cleanup job.")
    def delete(self,request,site_pk,asset_id):
        if request.data:
            raise ValidationError("Deletion accepts no fields or force override.")
        with translate_domain_errors():
            asset,job=remove_asset(request.user,site_pk,asset_id)
        return Response(DeletionSerializer(deletion_data(asset,job)).data,status=202)


class UsageSerializer(serializers.Serializer):
    id = serializers.CharField(read_only=True)
    scope = serializers.ChoiceField(choices=["DRAFT", "PUBLIC", "MANUAL"], read_only=True)
    page_id = serializers.UUIDField(read_only=True)
    revision_id = serializers.IntegerField(read_only=True)
    publication_id = serializers.IntegerField(read_only=True, allow_null=True)
    node_id = serializers.CharField(read_only=True)
    field_path = serializers.CharField(read_only=True)
    repeater_item_id = serializers.CharField(read_only=True, allow_blank=True)
    detachable = serializers.BooleanField(read_only=True)


class InventorySerializer(serializers.Serializer):
    asset_id = serializers.UUIDField(read_only=True)
    references = UsageSerializer(many=True, read_only=True)


class AssetInventory(MediaView):
    @extend_schema(tags=["Media"],responses=InventorySerializer,description="Current draft/publication inventory plus explicit placement references. Every entry is Site-owned. Automatic sets are revision-maintained; only MANUAL placements are detached through the reference API.")
    def get(self,request,site_pk,asset_id):
        asset=asset_for_site(request.user,site_pk,asset_id)
        rows=[{"id":str(row.pk),"scope":row.scope,"page_id":str(row.page_id),"revision_id":row.revision_id,"publication_id":row.publication_id,
               "node_id":row.node_id,"field_path":row.field_path,"repeater_item_id":row.repeater_item_id,"detachable":False}
              for row in MediaUsage.objects.filter(asset=asset,site_id=site_pk)]
        rows.extend({"id":str(row.pk),"scope":"MANUAL","page_id":str(row.page_revision.content_id),"revision_id":row.page_revision_id,"publication_id":None,
                     "node_id":row.node_id,"field_path":row.field_path,"repeater_item_id":row.repeater_item_id,"detachable":True}
                    for row in MediaAssetReference.objects.filter(asset=asset,site_id=site_pk).select_related("page_revision"))
        return Response({"asset_id":str(asset.pk),"references":rows})


class AssetDeletionStatus(MediaView):
    serializer_class=DeletionSerializer
    @extend_schema(tags=["Media"],responses=DeletionSerializer,description="Site media-delete permission required. Returns the durable cleanup state of an accepted deletion, without object keys.")
    def get(self,request,site_pk,asset_id):
        authorize(request.user,site_pk,"content.media.delete")
        job=MediaCleanup.objects.select_related("asset").filter(asset_id=asset_id,asset__site_id=site_pk).first()
        if job is None:
            from django.http import Http404
            raise Http404("Deletion not found.")
        return Response(DeletionSerializer(deletion_data(job.asset,job)).data)


class AssetImage(ImageDeliveryMixin, MediaView):
    @extend_schema(tags=["Media"], parameters=[OpenApiParameter("variant", str, enum=["thumbnail", "display"])], responses={(200, "image/webp"): {"type": "string", "format": "binary"}}, description="Private Site media view permission required. READY images only. Missing derivative revalidates and re-encodes the private original; original bytes/keys are never returned.")
    def get(self, request, site_pk, asset_id):
        return image_response(asset_for_site(request.user, site_pk, asset_id), request.query_params.get("variant", "thumbnail"))


class ReferenceList(MediaView):
    serializer_class = ReferenceSerializer

    @extend_schema(tags=["Media"], responses=ReferenceSerializer(many=True))
    def get(self, request, site_pk):
        page = self.paginate_queryset(references_for_site(request.user, site_pk))
        return self.get_paginated_response(ReferenceSerializer(page, many=True).data)

    @extend_schema(tags=["Media"], request=ReferenceInput, responses={201: ReferenceSerializer}, description="Attach a ready owned asset to an owned Page revision, node, field and optional repeater item. Requires media management and Page update permissions. A slot holds one asset; separate slots may reuse it.")
    def post(self, request, site_pk):
        data = ReferenceInput(data=request.data)
        data.is_valid(raise_exception=True)
        with translate_domain_errors():
            row = attach_asset(request.user, site_pk, **data.validated_data)
        return Response(ReferenceSerializer(row).data, status=status.HTTP_201_CREATED)


class ReferenceDetail(MediaView):
    serializer_class = ReferenceSerializer

    @extend_schema(tags=["Media"], responses={204: None}, description="Remove only this placement index entry. Retains the asset and other placements. Does not edit immutable Page revision snapshots.")
    def delete(self, request, site_pk, reference_id):
        with translate_domain_errors():
            detach_reference(request.user, site_pk, reference_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


urlpatterns = [
    path("<int:site_pk>/assets/upload/", AssetUpload.as_view(), name="media-asset-upload"),
    path("<int:site_pk>/assets/upload-policy/", UploadPolicy.as_view(), name="media-upload-policy"),
    path("<int:site_pk>/assets/", AssetList.as_view(), name="media-asset-list"),
    path("<int:site_pk>/assets/<uuid:asset_id>/references/",AssetInventory.as_view(),name="media-asset-inventory"),
    path("<int:site_pk>/assets/<uuid:asset_id>/deletion/",AssetDeletionStatus.as_view(),name="media-asset-deletion"),
    path("<int:site_pk>/assets/<uuid:asset_id>/image/", AssetImage.as_view(), name="media-asset-image"),
    path("<int:site_pk>/assets/<uuid:asset_id>/", AssetDetail.as_view(), name="media-asset-detail"),
    path("<int:site_pk>/asset-references/", ReferenceList.as_view(), name="media-reference-list"),
    path("<int:site_pk>/asset-references/<uuid:reference_id>/", ReferenceDetail.as_view(), name="media-reference-detail"),
]
