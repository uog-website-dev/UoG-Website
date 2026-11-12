# Site-owned media assets

`apps.media` owns canonical storage-object identity. `MediaAsset` has a required
Site, immutable globally unique `storage_reference`, original filename,
byte-detected MIME, byte count, SHA-256 checksum, optional dimensions, alt text,
status, creator, last metadata editor and timestamps. A reference has no copy of
the asset's technical metadata or ownership. Different storage objects may have
identical checksums; checksum is not the identity key.

Upload behavior is specified in [private media uploads](media-uploads.md). The
following catalog identity rules also cover trusted legacy registration.

## Storage identity and registration

The canonical reference is `bucket:sites/<site-id>/<object-key>`, using one of
the existing `platform-private`, `platform-public` or `platform-documents`
buckets. Empty/dot path segments and cross-Site prefixes are rejected. The
database unique constraint on `storage_reference` prevents two catalog records
for one object, including concurrent registrations and archived objects.
PostgreSQL rejects changes to ownership, identity, creator and technical
metadata through saves, bulk updates and raw SQL.

Registration reads an existing object through the server's storage adapter.
Byte count and checksum are streamed with a 100 MiB bound; neither is accepted
from the caller. MIME is classified from byte signatures (PNG, GIF, JPEG, WebP,
PDF; unknown bytes use `application/octet-stream`), not filename or an upload
header. PNG/GIF dimensions are optional detected metadata. This is not a full
decoder, antivirus scan, upload workflow or public delivery service. Object
producers must use write-once keys; overwriting an already registered object
outside this service violates the stored checksum contract.

The catalog foundation introduced no buckets or public delivery policies. The
upload service now writes server-generated keys to the existing private bucket;
it provides no signed URLs or public original-file delivery. Existing Page image strings and immutable revision JSON are not
rewritten or automatically registered. The change is additive, so legacy Pages
remain readable.

## Lifecycle, permissions and audit

| Current state | Allowed new state |
| --- | --- |
| PENDING | READY, REJECTED |
| READY | ARCHIVED |
| ARCHIVED | READY |
| REJECTED | None |

PENDING is the only creation state. Repeating the same state is a no-op. READY
means eligible for catalog references, not certification of file safety.
Archiving preserves identity, bytes and references. Resolution returns not
found while an asset is unavailable; restoring READY makes retained references
resolve again. Assets cannot be deleted. Archived Sites cannot mutate assets
or reference entries.

All mutations pass through Site-scoped services and the common transactional
hierarchy guard. Database triggers enforce immutable fields, status transitions,
actor identity and same-Site references, and write the shared audit record in
the same transaction. An audit failure rolls back metadata. Each record retains
the actor and owning Site plus before/after metadata. Unauthorized permissions
use the existing authorization audit path.

Reuse the existing `content.media.view`, `content.media.upload` and
`content.media.delete` permissions; upload covers catalog management and delete
means archive. Page reference mutations additionally require
`content.pages.update`. Standard Site Administrator and Platform Administrator
templates include these permissions. Migration `media.0003` updates existing
system-role links without adding users or assignments; the normal `seed_rbac`
deployment step reconciles full catalog descriptions and templates. Custom roles
are unchanged. Every selector requires permission in the requested Site and an
implemented, platform-available and Site-enabled MEDIA module. Deployment records
MEDIA as shipped but leaves the existing platform availability switch unchanged
(disabled on a clean database). Activate it explicitly before using the APIs.

`media_site_status_idx` is the B-tree on `(site_id, status, created_at DESC)` used
for scoped inventory/status queries. The storage-reference uniqueness constraint
provides its own unique index.

## Reference granularity

`MediaAssetReference` identifies one use by
`(page_revision_id, node_id, field_path, repeater_item_id)` with a unique database
constraint. The repeater ID is an optional stable item identity, not its array
position. A Slider node's `slides.image/slide-1` and a Gallery node's
`images.asset/image-1` can reference the same asset. Another Gallery item remains
a separate reference even when it uses that same asset. Both the asset and Page
revision must belong to the reference's Site; Posts cannot masquerade as Page
revisions. Reference identities cannot be edited or moved. Detaching removes
only one usage-index entry, not the asset, other uses or revision JSON.

The reference table is a usage index separate from immutable Page snapshots.
Builder adapters must create a new Page revision when changing document content,
then attach the new revision's normalized references. Removing an index entry
does not rewrite historical content. Revision cleanup must detach its index
entries through the guarded service before deleting linked history.
CMS draft-revision retention (`_prune_revisions`) and `SiteContent.delete`
call `detach_references_for_revisions` / `detach_references_for_content` so
PostgreSQL CASCADE never bypasses `media.asset_write`.
`media_reference_site_rev_idx` indexes `(site_id, page_revision_id)`.

## API and verification

Under `/api/v1/sites/{site_pk}/`: `assets/` supports paginated GET;
client-supplied storage registration POST has been removed. `assets/upload/`
accepts raw uploads and `assets/upload-policy/` reports configured limits; `assets/{asset_id}/` supports scoped GET and metadata PATCH;
`asset-references/` supports paginated GET and attachment POST;
`asset-references/{reference_id}/` supports detach DELETE. Metadata/references
are private and not cacheable. OpenAPI describes the inputs and responses.
The existing scoped revision list/detail APIs expose the immutable revision
`id` for `page_revision_id`; their authorization checks are unchanged.

See [verification evidence](../qa/media-assets-2026-11-10/report.md),
[schema migration](../../backend/apps/media/migrations/0001_initial.py),
[integrity triggers](../../backend/apps/media/migrations/0002_integrity.py), and
[two-Site, migration and placement tests](../../backend/tests/test_media_assets.py).

The user waived ADR-006 as a prerequisite. These choices follow the existing
shared-bucket deployment and Site-scoped authorization. The advanced Slider/Gallery
builder was not present in this checkout, so a builder-specific browser regression
remains unavailable. Foundation tests exercise Slider/Gallery-shaped placement
identities without claiming that those widgets have been implemented.

Search, deterministic paging and typed picker metadata are specified in
[media discovery and metadata maintenance](media-metadata.md).

Generated WebP variants, durable retries and scoped delivery are specified in
[image derivatives and thumbnails](media-thumbnails.md).

Current automatic draft/publication references and accepted deletion supersede
the initial archive-only removal policy. See [delivery and removal](media-removal.md)
for tombstones, publication protection, serialized linking and cleanup.
