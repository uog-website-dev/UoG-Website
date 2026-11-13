"""Accepted removal is a tombstone; private storage cleanup is a durable outbox."""
import logging
from contextlib import contextmanager
from datetime import timedelta
from django.db import connections, transaction
from django.http import Http404
from django.utils import timezone
from apps.audit.context import audit_context
from apps.organizations.hierarchy_lock import hierarchy_write
from apps.sites.api.access import Conflict
from .models import MediaAsset, MediaUsage, MediaCleanup, MediaDerivative
from .selectors import authorize
from .services import asset_write, storage_parts
from .processing import VARIANTS, derivative_reference
from .storage import ObjectStorage
from .object_lock import object_operation

log=logging.getLogger(__name__)


@contextmanager
def flags(*, using="default", deleting=False):
    names=["media.cleanup_write"] + (["media.deleting","media.processing"] if deleting else [])
    previous={}
    with connections[using].cursor() as cursor:
        for name in names:
            cursor.execute("SELECT current_setting(%s,true)",[name]);previous[name]=cursor.fetchone()[0] or ""
            cursor.execute("SELECT set_config(%s,'on',true)",[name])
    try: yield
    finally:
        if not connections[using].needs_rollback:
            with connections[using].cursor() as cursor:
                for name,value in previous.items(): cursor.execute("SELECT set_config(%s,%s,true)",[name,value])


def enqueue_cleanup(asset_id):
    try:
        from .tasks import cleanup_media_asset
        cleanup_media_asset.delay(str(asset_id))
    except Exception: log.warning("Media cleanup dispatch deferred",extra={"asset_id":str(asset_id)})


def remove_asset(actor,site_id,asset_id,*,using="default"):
    with asset_write(actor,site_id,"content.media.delete",using=using), flags(using=using,deleting=True):
        asset=MediaAsset.objects.using(using).select_for_update().filter(pk=asset_id,site_id=site_id).first()
        if asset is None: raise Http404("Asset not found.")
        if asset.deleted_at is not None: return asset,MediaCleanup.objects.using(using).get(asset=asset)
        logo = asset.site.configuration.get("identity", {}).get("logo_ref")
        if logo in {str(asset.pk), asset.pk.hex}:
            raise Conflict("Asset is assigned as this Site's logo.")
        if asset.references.exists() or MediaUsage.objects.using(using).filter(asset=asset).exists():
            raise Conflict("Asset is still referenced by a draft, publication or placement.")
        asset.deleted_at=timezone.now();asset.deleted_by=actor;asset.updated_by=actor;asset.status="ARCHIVED"
        asset.save(using=using,update_fields=["deleted_at","deleted_by","updated_by","updated_at","status"])
        job=MediaCleanup.objects.using(using).create(asset=asset,requested_by=actor)
        transaction.on_commit(lambda:enqueue_cleanup(asset.pk),using=using)
        return asset,job


@contextmanager
def cleanup_write(job, *, using="default"):
    with audit_context(actor_kind="USER", actor_id=str(job.requested_by_id)), hierarchy_write(using=using), flags(using=using):
        yield


def cleanup_asset(asset_id, *, storage=None, using="default"):
    with object_operation(asset_id, using=using) as acquired:
        if not acquired:
            return MediaCleanup.objects.using(using).filter(asset_id=asset_id).first()
        return _cleanup_asset(asset_id, storage=storage, using=using)


def _cleanup_asset(asset_id, *, storage=None, using="default"):
    job = MediaCleanup.objects.using(using).select_related("asset").filter(asset_id=asset_id).first()
    if job is None or job.state == "DONE":
        return job
    storage = storage or ObjectStorage()
    # Claim and collect immutable keys in a short transaction. An accepted
    # deletion remains authorized even if its Site is subsequently archived.
    with cleanup_write(job, using=using):
        job = MediaCleanup.objects.using(using).select_for_update().select_related("asset").get(asset_id=asset_id)
        if job.state == "DONE" or job.asset.deleted_at is None:
            return job
        if job.state == "RETRY" and job.available_at > timezone.now():
            return job
        refs = {job.asset.storage_reference, *MediaDerivative.objects.using(using).filter(asset_id=asset_id).values_list("storage_reference", flat=True)}
        refs.update(derivative_reference(job.asset, variant) for variant in VARIANTS)
        job.attempts += 1
        job.save(using=using)
    failed = False
    try:
        for reference in sorted(refs):
            bucket, key = storage_parts(reference, job.asset.site_id)
            if MediaAsset.objects.using(using).filter(storage_reference=reference, deleted_at__isnull=True).exclude(pk=asset_id).exists() or MediaDerivative.objects.using(using).filter(storage_reference=reference, asset__deleted_at__isnull=True).exclude(asset_id=asset_id).exists():
                raise ValueError("Storage object belongs to another identity")
            storage.delete(bucket, key)
    except Exception:
        failed = True
    with cleanup_write(job, using=using):
        job = MediaCleanup.objects.using(using).select_for_update().get(asset_id=asset_id)
        if failed:
            job.state = "RETRY"
            job.available_at = timezone.now() + timedelta(seconds=min(3600, 10 * 2 ** min(job.attempts - 1, 9)))
        else:
            job.state = "DONE"
            job.completed_at = timezone.now()
        job.save(using=using)
    return job
