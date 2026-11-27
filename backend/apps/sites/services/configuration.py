"""Apply an allowlisted configuration change to one Site."""
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db import DEFAULT_DB_ALIAS

from apps.organizations.hierarchy_lock import hierarchy_write

from ..banner import default_banner
from ..configuration import merge_site_configuration, normalize_site_configuration
from ..models import Site
from apps.media.models import MediaAsset
from apps.sites.selectors.modules import module_is_available


def apply_site_configuration(site_id, changes, *, using=DEFAULT_DB_ALIAS):
    """Validate and persist changes for site_id without reading other Sites."""
    with hierarchy_write(using=using):
        site = Site.objects.using(using).select_for_update().get(pk=site_id)
        site.configuration = normalize_site_configuration(
            site.configuration, default_language=site.default_language,
        )
        previous = site.configuration
        site.configuration = merge_site_configuration(site.configuration, changes)
        site.configuration = normalize_site_configuration(
            site.configuration, default_language=site.default_language,
        )
        _validate_changed_images(site.pk, previous, site.configuration, changes, using=using)
        site.save(using=using, update_fields=["configuration"])
        return site


def _validate_changed_images(site_id, previous, current, changes, *, using):
    identity = changes.get("identity") if isinstance(changes, dict) else None
    previous_logo = previous["identity"]["logo_ref"]
    if (
        isinstance(identity, dict) and "logo_ref" in identity
        and identity["logo_ref"] != previous_logo
        and current["identity"]["logo_ref"] is not None
    ):
        _validate_image(site_id, current["identity"]["logo_ref"], field="identity.logo_ref", using=using)

    previous_banner = previous.get("presentation", {}).get("banner") or default_banner()
    current_banner = current["presentation"]["banner"]
    for slot in ("shared", "page", "post"):
        before = previous_banner.get(slot, {}).get("image_ref")
        after = current_banner[slot]["image_ref"]
        if after is not None and after != before:
            _validate_image(site_id, after, field=f"presentation.banner.{slot}.image_ref", using=using)


def _validate_image(site_id, reference, *, field, using):
    try:
        asset_id = UUID(reference)
    except (TypeError, ValueError, AttributeError):
        raise ValidationError({field: "Choose a ready image from this Site's Media Library."})
    asset = MediaAsset.objects.using(using).filter(
        pk=asset_id, site_id=site_id, status=MediaAsset.Status.READY,
        deleted_at__isnull=True, detected_mime__in=("image/png", "image/jpeg", "image/webp"),
    ).exclude(processing__state__in=("QUEUED", "PROCESSING", "RETRY", "FAILED")).first()
    if asset is None:
        raise ValidationError({field: "Choose a ready image from this Site's Media Library."})
    if not module_is_available(site_id, "MEDIA", using=using):
        raise ValidationError({field: "The Media Library must be available to configure a Site banner image."})


def _validate_logo(site_id, reference, *, using):
    _validate_image(site_id, reference, field="identity.logo_ref", using=using)
