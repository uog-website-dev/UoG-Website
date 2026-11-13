"""Private immutable revision previews and reference-scoped image delivery."""
import json
from django.db import connection
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from apps.sites.api.serializers import StrictFields
from apps.sites.selectors.modules import module_is_available
from apps.media.delivery import image_response
from apps.media.models import MediaAsset
from ..models import ContentRevision, ContentWorkflowTransition


class PreviewQuery(StrictFields,serializers.Serializer):
    revision=serializers.IntegerField(required=False,min_value=1,max_value=2147483647)
    asset_id=serializers.UUIDField(required=False)
    variant=serializers.ChoiceField(choices=("thumbnail","display"),required=False,default="display")


class PagePreviewSerializer(serializers.Serializer):
    revision_id=serializers.IntegerField()
    revision_number=serializers.IntegerField()
    content_hash=serializers.CharField()
    status=serializers.CharField()
    approval_id=serializers.IntegerField(allow_null=True)
    reviewed_revision_id=serializers.IntegerField(allow_null=True)
    approved_revision_id=serializers.IntegerField(allow_null=True)
    page=serializers.JSONField()


def preview_revision(request,page):
    repeated={key:["Supply this parameter only once."] for key in request.query_params if len(request.query_params.getlist(key)) != 1}
    if repeated:raise serializers.ValidationError(repeated)
    query=PreviewQuery(data=request.query_params);query.is_valid(raise_exception=True)
    revision=get_object_or_404(ContentRevision,content_id=page.pk,site_id=page.site_id,
                               revision_number=query.validated_data.get("revision",page.revision_number))
    payload=revision.snapshot
    asset_id=query.validated_data.get("asset_id")
    if asset_id:
        if not module_is_available(page.site_id,"MEDIA"):raise NotFound("Image unavailable.")
        layout=(payload.get("metadata") or {}).get("visual_layout")
        if layout is not None:
            from ..services.visual_publication import references
            allowed=any(str(asset_id)==value for value,_ in references(layout))
        else:
            with connection.cursor() as cursor:
                cursor.execute("SELECT EXISTS(SELECT 1 FROM media_extract_uses(%s::jsonb,%s) WHERE asset_id=%s)",[json.dumps(payload.get("blocks",[])),page.site_id,asset_id])
                allowed=cursor.fetchone()[0]
        if not allowed:raise NotFound("Image unavailable.")
        asset=get_object_or_404(MediaAsset.objects.select_related("site","processing"),pk=asset_id,site_id=page.site_id,deleted_at__isnull=True)
        return image_response(asset,query.validated_data["variant"])
    approval=ContentWorkflowTransition.objects.filter(content_id=page.pk,to_status="APPROVED").filter(Q(revision=revision)|Q(reviewed_revision=revision)).order_by("-id").first()
    frozen={key:payload.get(key) for key in ("title","path","blocks","blocks_version","metadata","seo","layout","visibility")}
    frozen["site"]=page.site_id
    frozen["id"]=str(page.pk)
    return Response({"revision_id":revision.pk,"revision_number":revision.revision_number,"content_hash":revision.content_hash,
        "status":revision.status,"approval_id":approval.pk if approval else None,
        "reviewed_revision_id":approval.reviewed_revision_id if approval else None,
        "approved_revision_id":approval.revision_id if approval else None,"page":frozen},
        headers={"ETag":f'"cms-content-{page.pk}-r{revision.revision_number}"'})
