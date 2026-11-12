from django.core.exceptions import PermissionDenied
from django.http import Http404
from django.db.models import Q

from apps.authorization.services import permission_granted
from apps.sites.selectors.modules import module_is_available
from .models import MediaAsset, MediaAssetReference


def authorize(actor, site_id, permission="content.media.view", *, using="default"):
    if not permission_granted(actor, permission, site_id=site_id):
        raise PermissionDenied("A media permission assigned to this Site is required.")
    if not module_is_available(site_id, "MEDIA", using=using):
        raise PermissionDenied("MEDIA is not available for this Site.")


READY_IMAGE_TYPES = ("image/png", "image/jpeg", "image/webp")


def assets_for_site(actor, site_id, *, status=None, search="", type=None,
                    content_type=None, ready_images=False, ordering="-created_at", using="default"):
    authorize(actor, site_id, using=using)
    rows = MediaAsset.objects.using(using).select_related("site", "processing").filter(site_id=site_id, deleted_at__isnull=True)
    if status:
        rows = rows.filter(status=status)
    if search:
        rows = rows.filter(Q(original_filename__icontains=search) | Q(display_name__icontains=search))
    if type == "image":
        rows = rows.filter(detected_mime__startswith="image/")
    elif type == "document":
        rows = rows.filter(detected_mime__in=("application/pdf", "text/plain"))
    if content_type:
        rows = rows.filter(detected_mime=content_type)
    if ready_images:
        rows = rows.filter(status="READY", detected_mime__in=READY_IMAGE_TYPES).exclude(processing__state__in=["QUEUED", "PROCESSING", "RETRY", "FAILED"])
    # A UUID tie-breaker is required even when all filenames/timestamps match.
    return rows.order_by(ordering, "id")


def asset_for_site(actor, site_id, asset_id, *, using="default", lock=False):
    rows = assets_for_site(actor, site_id, using=using)
    if lock:
        rows = rows.select_for_update(of=("self",))
    try:
        return rows.get(pk=asset_id)
    except MediaAsset.DoesNotExist as error:
        raise Http404("Asset not found.") from error


def references_for_site(actor, site_id, *, using="default"):
    authorize(actor, site_id, using=using)
    return MediaAssetReference.objects.using(using).filter(site_id=site_id)


def resolve_reference(actor, site_id, reference_id, *, using="default"):
    try:
        reference = references_for_site(actor, site_id, using=using).get(pk=reference_id)
    except MediaAssetReference.DoesNotExist as error:
        raise Http404("Reference not found.") from error
    asset = assets_for_site(actor, site_id, status=MediaAsset.Status.READY, using=using).filter(pk=reference.asset_id).first()
    if asset is None:
        raise Http404("Asset is unavailable.")
    return asset
