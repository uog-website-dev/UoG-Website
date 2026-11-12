"""Guarded catalog mutations. Registration reads bytes from trusted storage."""
import hashlib
import re
import struct
import unicodedata
from contextlib import contextmanager

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import connections
from django.http import Http404

from apps.audit.context import audit_context, current_audit_context, database_audit_context
from apps.cms.models import ContentRevision, Page
from apps.organizations.hierarchy_lock import hierarchy_write
from apps.sites.models import Site
from .models import MediaAsset, MediaAssetReference
from .selectors import authorize, asset_for_site, references_for_site

MAX_OBJECT_BYTES = 100 * 1024 * 1024
TRANSITIONS = {"PENDING": {"READY", "REJECTED"}, "READY": {"ARCHIVED"}, "ARCHIVED": {"READY"}, "REJECTED": set()}


@contextmanager
def _media_write_session(actor, site_id, *, using="default"):
    """DB write guard + USER audit for media mutations (no permission check)."""
    context = current_audit_context()
    with audit_context(actor_kind="USER", actor_id=str(actor.pk), request_id=context.request_id, ip=context.ip), hierarchy_write(using=using), database_audit_context(using=using):
        if Site.objects.using(using).get(pk=site_id).status == Site.Status.ARCHIVED:
            raise ValidationError("Archived Sites cannot change media.")
        with connections[using].cursor() as cursor:
            cursor.execute("SELECT current_setting('media.asset_write', true)")
            previous = cursor.fetchone()[0] or ""
            cursor.execute("SELECT set_config('media.asset_write', 'on', true)")
        try:
            yield
        finally:
            # On error the enclosing transaction restores SET LOCAL itself.
            if not connections[using].needs_rollback:
                with connections[using].cursor() as cursor:
                    cursor.execute("SELECT set_config('media.asset_write', %s, true)", [previous])


@contextmanager
def asset_write(actor, site_id, permission, *, using="default"):
    authorize(actor, site_id, permission, using=using)
    with _media_write_session(actor, site_id, using=using):
        authorize(actor, site_id, permission, using=using)
        yield


def storage_parts(reference, site_id):
    if not isinstance(reference, str) or len(reference) > 1100 or not re.fullmatch(
        r"(platform-public|platform-private|platform-documents):sites/" + str(site_id) + r"/[A-Za-z0-9._/-]+", reference,
    ):
        raise ValidationError("Storage reference must use this Site's approved storage namespace.")
    bucket, key = reference.split(":", 1)
    if any(part in {"", ".", ".."} for part in key.split("/")):
        raise ValidationError("Storage reference is not canonical.")
    return bucket, key


def inspect_bytes(stream):
    digest, count, header = hashlib.sha256(), 0, b""
    while chunk := stream.read(64 * 1024):
        count += len(chunk)
        if count > MAX_OBJECT_BYTES:
            raise ValidationError("Asset exceeds the 100 MiB catalog limit.")
        header = (header + chunk)[:32]
        digest.update(chunk)
    mime, width, height = "application/octet-stream", None, None
    if header.startswith(b"\x89PNG\r\n\x1a\n") and len(header) >= 24 and header[12:16] == b"IHDR":
        mime = "image/png"
        width, height = struct.unpack(">II", header[16:24])
        if not (0 < width <= 2_147_483_647 and 0 < height <= 2_147_483_647):
            raise ValidationError("Invalid PNG dimensions.")
    elif header.startswith((b"GIF87a", b"GIF89a")) and len(header) >= 10:
        mime = "image/gif"
        width, height = struct.unpack("<HH", header[6:10])
        if not width or not height:
            raise ValidationError("Invalid GIF dimensions.")
    elif header.startswith(b"\xff\xd8\xff"):
        mime = "image/jpeg"
    elif header.startswith(b"%PDF-"):
        mime = "application/pdf"
    elif header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        mime = "image/webp"
    return dict(detected_mime=mime, byte_count=count, checksum=digest.hexdigest(), width=width, height=height)


def register_asset(actor, site_id, *, storage_reference, original_filename, storage=None, using="default"):
    """Catalog an already stored object; callers cannot assert technical metadata.

    The adapter is server-owned and exposes open(bucket, key). No object upload,
    deletion or public URL policy is implied by registering catalog identity.
    """
    authorize(actor, site_id, "content.media.upload", using=using)
    bucket, key = storage_parts(storage_reference, site_id)
    if not isinstance(original_filename, str) or not original_filename.strip() or len(original_filename) > 255 or any(c in original_filename for c in "\\/\x00\r\n"):
        raise ValidationError("An original filename without path components is required.")
    if storage is None:
        from .storage import ObjectStorage
        storage = ObjectStorage()
    with storage.open(bucket, key) as stream:
        technical = inspect_bytes(stream)
    with asset_write(actor, site_id, "content.media.upload", using=using):
        return MediaAsset.objects.using(using).create(
            site_id=site_id, storage_reference=storage_reference, original_filename=original_filename,
            created_by=actor, updated_by=actor, **technical,
        )


def update_asset(actor, site_id, asset_id, *, changes, using="default"):
    if changes.get("status") == MediaAsset.Status.ARCHIVED:
        authorize(actor, site_id, "content.media.delete", using=using)
    with asset_write(actor, site_id, "content.media.upload", using=using):
        row = asset_for_site(actor, site_id, asset_id, using=using, lock=True)
        if set(changes) - {"display_name", "categories", "alt_text", "status"}:
            raise ValidationError("Only media name, categories, alt text and lifecycle status may change. Ownership and storage metadata are immutable.")
        changes = dict(changes)
        if "display_name" in changes:
            name = changes["display_name"]
            if not isinstance(name, str) or not name.strip() or len(name) > 255 or any(unicodedata.category(c) == "Cc" for c in name):
                raise ValidationError({"display_name": "Use a media name of 1 to 255 characters without control characters."})
            changes["display_name"] = name.strip()
        if "categories" in changes:
            values = changes["categories"]
            if not isinstance(values, list) or len(values) > 10 or any(not isinstance(v, str) or not v.strip() or len(v) > 64 or any(unicodedata.category(c) == "Cc" for c in v) for v in values):
                raise ValidationError({"categories": "Use at most 10 category labels, each 1 to 64 characters."})
            labels = {}
            for value in values:
                labels.setdefault(value.strip().casefold(), value.strip())
            changes["categories"] = list(labels.values())
        wanted = changes.get("status", row.status)
        if wanted == "ARCHIVED" and wanted != row.status:
            from .models import MediaUsage
            if row.references.exists() or MediaUsage.objects.using(using).filter(asset=row).exists():
                raise ValidationError("Referenced assets cannot be removed or archived.")
        if wanted != row.status and row.status == "PENDING" and hasattr(row, "upload"):
            raise ValidationError("Uploaded assets must complete worker validation before changing state.")
        if wanted != row.status and wanted not in TRANSITIONS[row.status]:
            raise ValidationError("Illegal asset status transition.")
        if "alt_text" in changes and (not isinstance(changes["alt_text"], str) or len(changes["alt_text"]) > 1000):
            raise ValidationError("Alt text must be a string of at most 1000 characters.")
        if all(getattr(row, key) == value for key, value in changes.items()):
            return row
        for key, value in changes.items():
            setattr(row, key, value)
        row.updated_by = actor
        row.save(using=using, update_fields=[*changes, "updated_by", "updated_at"])
        return row


def attach_asset(actor, site_id, *, asset_id, page_revision_id, node_id, field_path, repeater_item_id="", using="default"):
    with asset_write(actor, site_id, "content.media.upload", using=using):
        row = asset_for_site(actor, site_id, asset_id, using=using, lock=True)
        authorize(actor, site_id, "content.pages.update", using=using)
        revision = ContentRevision.objects.using(using).filter(pk=page_revision_id, site_id=site_id).first()
        if revision is None or not Page.objects.using(using).filter(pk=revision.content_id, site_id=site_id).exists():
            raise Http404("Page revision not found.")
        if row.status != MediaAsset.Status.READY or (getattr(row, "processing", None) is not None and row.processing.state != "READY"):
            raise ValidationError("Only ready assets can be referenced.")
        reference = MediaAssetReference(
            site_id=site_id, asset=row, page_revision=revision, node_id=node_id,
            field_path=field_path, repeater_item_id=repeater_item_id, created_by=actor,
        )
        reference.full_clean()
        reference.save(using=using)
        return reference


def detach_reference(actor, site_id, reference_id, *, using="default"):
    with asset_write(actor, site_id, "content.media.upload", using=using):
        authorize(actor, site_id, "content.pages.update", using=using)
        row = references_for_site(actor, site_id, using=using).filter(pk=reference_id).first()
        if row is None:
            raise Http404("Reference not found.")
        row.delete(using=using)


def detach_references_for_revisions(*, site_id, revision_ids, actor=None, using="default"):
    """Detach usage-index rows before CMS revision retention or content delete.

    Called from CMS cleanup so PostgreSQL CASCADE never bypasses the media
    write guard. Does not delete assets or rewrite revision JSON. Skips the
    interactive MEDIA permission/module gate because the owning CMS mutation
    already authorized the content change; still uses the transactional media
    write flag, USER audit actor and archived-Site freeze.
    """
    ids = [pk for pk in revision_ids if pk is not None]
    if not ids:
        return 0
    rows = MediaAssetReference.objects.using(using).filter(
        site_id=site_id, page_revision_id__in=ids,
    )
    if not rows.exists():
        return 0
    if actor is None or not getattr(actor, "pk", None):
        actor_id = rows.values_list("created_by_id", flat=True).first()
        actor = get_user_model().objects.using(using).get(pk=actor_id)
    with _media_write_session(actor, site_id, using=using):
        deleted, _ = rows.delete()
    return deleted


def detach_references_for_content(content, *, actor=None, using="default"):
    """Detach every placement for one SiteContent before it is deleted."""
    with hierarchy_write(using=using):
        with connections[using].cursor() as cursor:
            cursor.execute("SELECT media_replace_usage(%s,'DRAFT',NULL,NULL,'[]'::jsonb)", [content.pk])
            cursor.execute("SELECT media_replace_usage(%s,'PUBLIC',NULL,NULL,'[]'::jsonb)", [content.pk])
    revision_ids = list(
        ContentRevision.objects.using(using)
        .filter(content_id=content.pk)
        .values_list("pk", flat=True)
    )
    return detach_references_for_revisions(
        site_id=content.site_id,
        revision_ids=revision_ids,
        actor=actor or content.updated_by or content.created_by,
        using=using,
    )
