"""Apply an allowlisted configuration change to one Site."""
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db import DEFAULT_DB_ALIAS

from apps.organizations.hierarchy_lock import hierarchy_write

from ..configuration import merge_site_configuration
from ..models import Site
from apps.media.models import MediaAsset
from apps.sites.selectors.modules import module_is_available


def apply_site_configuration(site_id, changes, *, using=DEFAULT_DB_ALIAS):
    """Validate and persist changes for site_id without reading other Sites."""
    with hierarchy_write(using=using):
        site = Site.objects.using(using).select_for_update().get(pk=site_id)
        previous_logo = site.configuration["identity"]["logo_ref"]
        site.configuration = merge_site_configuration(site.configuration, changes)
        identity = changes.get("identity") if isinstance(changes, dict) else None
        if (
            isinstance(identity, dict) and "logo_ref" in identity
            and identity["logo_ref"] != previous_logo
            and identity["logo_ref"] is not None
        ):
            _validate_logo(site.pk, identity["logo_ref"], using=using)
        site.save(using=using, update_fields=["configuration"])
        return site


def _validate_logo(site_id, reference, *, using):
    try:
        asset_id = UUID(reference)
    except (TypeError, ValueError, AttributeError):
        raise ValidationError({"identity.logo_ref": "Choose a ready image from this Site's Media Library."})
    asset = MediaAsset.objects.using(using).filter(
        pk=asset_id, site_id=site_id, status=MediaAsset.Status.READY,
        deleted_at__isnull=True, detected_mime__in=("image/png", "image/jpeg", "image/webp"),
    ).exclude(processing__state__in=("QUEUED", "PROCESSING", "RETRY", "FAILED")).first()
    if asset is None:
        raise ValidationError({"identity.logo_ref": "Choose a ready image from this Site's Media Library."})
    if not module_is_available(site_id, "MEDIA", using=using):
        raise ValidationError({"identity.logo_ref": "The Media Library must be available to configure a Site logo."})
