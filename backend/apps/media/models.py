import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone


class MediaAsset(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        READY = "READY", "Ready"
        REJECTED = "REJECTED", "Rejected"
        ARCHIVED = "ARCHIVED", "Archived"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey("sites.Site", on_delete=models.PROTECT, related_name="media_assets")
    storage_reference = models.CharField(max_length=1100, unique=True)
    original_filename = models.CharField(max_length=255)
    display_name = models.CharField(max_length=255, blank=True, default="")
    categories = models.JSONField(default=list, blank=True)
    detected_mime = models.CharField(max_length=127)
    byte_count = models.PositiveBigIntegerField()
    checksum = models.CharField(max_length=64, help_text="SHA-256 of the object bytes.")
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.PENDING)
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)
    alt_text = models.CharField(max_length=1000, blank=True, default="")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_media_assets")
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="updated_media_assets")
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT, related_name="deleted_media_assets")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at", "id")
        indexes = [models.Index(fields=("site", "status", "-created_at"), name="media_site_status_idx")]
        constraints = [
            models.CheckConstraint(condition=models.Func("categories", function="media_categories_valid", output_field=models.BooleanField()), name="media_asset_categories_valid"),
            models.CheckConstraint(condition=Q(status__in=["PENDING", "READY", "REJECTED", "ARCHIVED"]), name="media_asset_status"),
            models.CheckConstraint(condition=Q(checksum__regex=r"\A[a-f0-9]{64}\Z"), name="media_asset_checksum"),
            models.CheckConstraint(condition=~Q(original_filename__regex=r"^\s*$"), name="media_asset_filename"),
            models.CheckConstraint(condition=Q(detected_mime__regex=r"\A[a-z0-9.+-]+/[a-z0-9.+-]+\Z"), name="media_asset_mime"),
            models.CheckConstraint(condition=(Q(width__isnull=True, height__isnull=True) | Q(width__isnull=False, height__isnull=False, width__gt=0, height__gt=0)), name="media_asset_dimensions"),
        ]

    def delete(self, *args, **kwargs):
        raise ValidationError("Archive assets; storage identities and retained references cannot be deleted.")


class MediaAssetReference(models.Model):
    """A use of an asset, not another asset or ownership record."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey("sites.Site", on_delete=models.PROTECT, related_name="media_references")
    asset = models.ForeignKey(MediaAsset, on_delete=models.PROTECT, related_name="references")
    page_revision = models.ForeignKey("cms.ContentRevision", on_delete=models.CASCADE, related_name="media_references")
    node_id = models.CharField(max_length=128)
    field_path = models.CharField(max_length=256)
    repeater_item_id = models.CharField(max_length=128, blank=True, default="")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("created_at", "id")
        constraints = [
            models.UniqueConstraint(fields=("page_revision", "node_id", "field_path", "repeater_item_id"), name="media_reference_slot_uniq"),
            models.CheckConstraint(condition=~Q(node_id__regex=r"^\s*$"), name="media_reference_node"),
            models.CheckConstraint(condition=~Q(field_path__regex=r"^\s*$"), name="media_reference_field"),
        ]
        indexes = [models.Index(fields=("site", "page_revision"), name="media_reference_site_rev_idx")]


class MediaUpload(models.Model):
    """One logical request; attempts get separate, never reused object keys."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey("sites.Site", on_delete=models.PROTECT)
    creator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    request_key = models.UUIDField()
    original_filename = models.CharField(max_length=255)
    asset = models.OneToOneField(MediaAsset, null=True, on_delete=models.PROTECT, related_name="upload")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=("site", "creator", "request_key"), name="media_upload_request_uniq")]


class MediaUploadAttempt(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    upload = models.ForeignKey(MediaUpload, on_delete=models.CASCADE, related_name="attempts")
    storage_reference = models.CharField(max_length=1100, unique=True)
    state = models.CharField(max_length=8, default="WRITING", choices=[("WRITING", "Writing"), ("STORED", "Stored"), ("FAILED", "Failed")])
    expires_at = models.DateTimeField(db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)


class MediaProcessing(models.Model):
    asset = models.OneToOneField(MediaAsset, primary_key=True, on_delete=models.CASCADE, related_name="processing")
    state = models.CharField(max_length=10, default="QUEUED", choices=[(value, value.title()) for value in ("QUEUED", "PROCESSING", "RETRY", "READY", "FAILED")])
    attempts = models.PositiveIntegerField(default=0)
    token = models.UUIDField(default=uuid.uuid4)
    available_at = models.DateTimeField(default=timezone.now)
    lease_until = models.DateTimeField(null=True)
    failure_code = models.CharField(max_length=32, blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)


class MediaDerivative(models.Model):
    asset = models.ForeignKey(MediaAsset, on_delete=models.CASCADE, related_name="derivatives")
    variant = models.CharField(max_length=10, choices=[("thumbnail", "Thumbnail"), ("display", "Display")])
    storage_reference = models.CharField(max_length=1100, unique=True)
    checksum = models.CharField(max_length=64)
    byte_count = models.PositiveIntegerField()
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=("asset", "variant"), name="media_derivative_variant_uniq")]


class MediaUsage(models.Model):
    """Current draft/publication inventory; immutable historical snapshots stay separate."""
    asset = models.ForeignKey(MediaAsset, on_delete=models.PROTECT, related_name="usage")
    site = models.ForeignKey("sites.Site", on_delete=models.PROTECT)
    page = models.ForeignKey("cms.Page", on_delete=models.CASCADE)
    revision = models.ForeignKey("cms.ContentRevision", on_delete=models.PROTECT)
    publication = models.ForeignKey("cms.PublishedContentSnapshot", null=True, on_delete=models.PROTECT)
    scope = models.CharField(max_length=6, choices=[("DRAFT","Draft"),("PUBLIC","Public")])
    node_id = models.CharField(max_length=128)
    field_path = models.CharField(max_length=256)
    repeater_item_id = models.CharField(max_length=128, default="", blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT)
    class Meta:
        ordering = ("page_id", "scope", "node_id", "field_path", "repeater_item_id")
        constraints = [models.UniqueConstraint(fields=("page","scope","node_id","field_path","repeater_item_id"),name="media_usage_slot_uniq")]


class MediaCleanup(models.Model):
    asset = models.OneToOneField(MediaAsset, primary_key=True, on_delete=models.PROTECT, related_name="cleanup")
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    state = models.CharField(max_length=6, default="QUEUED", choices=[("QUEUED","Queued"),("RETRY","Retry"),("DONE","Done")])
    attempts = models.PositiveIntegerField(default=0)
    available_at = models.DateTimeField(default=timezone.now)
    completed_at = models.DateTimeField(null=True)
