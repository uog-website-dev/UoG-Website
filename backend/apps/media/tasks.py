"""Bounded deliveries backed by a durable processing attempt budget."""
from celery import shared_task
from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from .models import MediaAsset, MediaProcessing
from . import uploads
from .processing import RetryableMediaError
from .selectors import READY_IMAGE_TYPES


@shared_task(bind=True, name="media.process_asset", soft_time_limit=45, time_limit=60)
def process_media_asset(self, asset_id):
    try:
        asset = uploads.process_asset(asset_id)
        if asset is None:
            return None
        state = MediaProcessing.objects.filter(asset=asset).values_list("state", flat=True).first()
        return {"asset_id": str(asset.pk), "status": asset.status, "processing_state": state or asset.status}
    except RetryableMediaError as error:
        raise self.retry(exc=error, countdown=settings.MEDIA_PROCESSING_RETRY_SECONDS * 2 ** self.request.retries,
                         max_retries=max(0, settings.MEDIA_PROCESSING_MAX_ATTEMPTS - 1))


@shared_task(name="media.reconcile_uploads")
def reconcile_uploads():
    now = timezone.now()
    rows = MediaAsset.objects.filter(status__in=["PENDING", "READY"]).exclude(site__status="ARCHIVED").filter(
        Q(upload__isnull=False) | Q(detected_mime__in=READY_IMAGE_TYPES)).filter(
        Q(processing__isnull=True) | Q(processing__state="QUEUED") |
        Q(processing__state="RETRY", processing__available_at__lte=now) |
        Q(processing__state="PROCESSING", processing__lease_until__lte=now))
    for asset_id in rows.values_list("pk", flat=True).iterator():
        uploads.enqueue(asset_id)
    from .models import MediaCleanup
    for asset_id in MediaCleanup.objects.exclude(state="DONE").filter(available_at__lte=now).values_list("asset_id",flat=True).iterator():
        cleanup_media_asset.delay(str(asset_id))
    return uploads.reconcile_attempts()


@shared_task(name="media.cleanup_asset",soft_time_limit=45,time_limit=60)
def cleanup_media_asset(asset_id):
    from .removal import cleanup_asset
    job=cleanup_asset(asset_id)
    return {"asset_id":str(asset_id),"state":job.state} if job else None
