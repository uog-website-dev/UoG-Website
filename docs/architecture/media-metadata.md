# Site media discovery and metadata maintenance

## Scoped discovery contract

`GET /api/v1/sites/{site_pk}/assets/` authorizes the current user for this Site's
`content.media.view` and effective MEDIA module. All filters are combined inside
the owning Site queryset before count, ordering and pagination. Foreign IDs under
an authorized Site return 404 from detail/edit; a Site without permission is 403.

| Query | Contract |
| --- | --- |
| search | Literal case-insensitive media name or original filename substring, maximum 255 characters; surrounding whitespace trimmed |
| status | PENDING, READY, REJECTED or ARCHIVED; Processing in the UI means PENDING |
| type | image (image/*) or document (application/pdf or text/plain) |
| content_type | Exact lowercase detected MIME, maximum 127 characters |
| ready_images | Boolean; true means READY PNG/JPEG/WebP images owned by this Site |
| ordering | created_at, -created_at, original_filename, -original_filename |
| page | Positive integer, default 1 |
| page_size | Integer 1?100, default 20 |

Unknown/repeated parameters and invalid values return 400. `ready_images=true`
with a non-READY status, document type or unsupported image MIME also returns
400. A page beyond the result set returns 404. Search treats `%`, `_` and
backslashes literally through Django's escaped substring lookup.

Ordering always appends ascending asset UUID. The default is
`created_at DESC, id ASC`; filename order is `original_filename ASC, id ASC`.
Both stay deterministic with identical filenames and timestamps. Offset pages
are deterministic for the same dataset, not a frozen snapshot across concurrent
uploads or metadata/status changes. Every filter runs before pagination so a
picker page is not consumed by processing files or documents.

The existing `media_site_status_idx` B-tree covers Site, status and descending
creation time. The required UUID tie-breaker and filename filtering/sorting can
require additional filtering/sorting. The editable-metadata migration adds display_name and categories, with a category JSON check; it adds no index or extension.

## Readable and writable metadata

The list and scoped detail return stable `id`, Site, editable `display_name`, categories, original filename, detected
MIME (`content_type`, with compatible `detected_mime`), byte count, checksum,
status/processing_state, dimensions, persisted alt text, creator/editor and
timestamps. Internal storage references, object keys, bucket names, credentials
and original-file URLs are absent from these serializers and the shared types.

`thumbnail_status` and a scoped thumbnail URL are read-only. The image pipeline
now reports PROCESSING, READY, FAILED, NOT_GENERATED (legacy), NOT_APPLICABLE or
UNAVAILABLE, plus attempt count and a sanitized failure code. See
[derivative and fallback policy](media-thumbnails.md). Storage keys and original
URLs remain private; active/failed jobs are excluded before picker pagination.

`PATCH .../assets/{asset_id}/` accepts `display_name` (nonblank plain text, at most 255 characters), `categories` (up to ten nonblank labels of 64 characters), `alt_text` (plain text, at most 1000 characters, blank allowed) and lifecycle `status`. Category labels are deduplicated case-insensitively. Names fall back to the immutable original filename for existing assets. Search matches both fields. Uploaded PENDING rows remain
worker-controlled. Existing lifecycle/permission rules continue to apply, including
archive permission. Metadata updates retain the Site row guard, actor/Site audit
and immutable identity/technical metadata. A request mixing an allowed alt-text
change with a protected field is rejected atomically. PATCH does not use ETags;
it locks and updates only supplied fields. The new typed client uses an explicit
non-conditional PATCH method rather than inventing a version token.

The Site Media library includes filename search, status/type filters, pagination,
scoped details and alt-text editing for users with media-management permission.
Read-only users may inspect details but cannot submit metadata changes. Alt text
shown to pickers is the persisted server response, not an unsaved form value; no
separate alt-text approval workflow is introduced.

## Typed Image, Slider and Gallery boundary

Shared `@uog/types` exports `MediaAsset`, `MediaStatus`, `MediaListQuery` and
`MediaMetadataPatch`. `@uog/api-client` exports `createLiveMediaAdapter` with
list, detail, update and `readyImages(siteId, query)` methods. The ready-image
helper always sends `ready_images=true`; it is the shared contract for Image,
Slider and Gallery controls. Update inputs omit ownership, storage identity and
technical fields, with a runtime allowlist in addition to the backend guard.

The current Page image picker now requests ready images on the server, including
filename search and page number. Client filtering is defense in depth, not the
pagination mechanism. It passes the selected asset's UUID and persisted alt text
back to the Page editor. Existing ready-only placement services still prevent
PENDING/REJECTED/foreign references.

Advanced Slider/Gallery widgets are absent in this checkout. Their shared API
boundary and generic reference lifecycle are covered; a widget-specific browser
regression cannot be claimed. The shared portal renderer now uses approved responsive derivatives for scoped
UUID references, retaining alt-text fallback for unavailable or legacy images.
It does not expose original storage.

## Verification

See the [OpenAPI contract](../api/openapi.yaml),
[filter/read/write schema snapshot](../qa/media-metadata-2026-11-11/openapi-filter-schema.json),
[database constraint/index snapshot](../qa/media-metadata-2026-11-11/database-schema.json),
[two-Site fixture pages](../qa/media-metadata-2026-11-11/two-site-fixture-results.json),
[allowed/rejected mutation fixtures](../qa/media-metadata-2026-11-11/mutation-fixture-results.json)
and [test report](../qa/media-metadata-2026-11-11/report.md).

## Multiple-file upload UI

The library supports browsing or dropping up to 20 files, with two concurrent transfers. Each queued file has editable name, category labels and alt text. The secure raw upload is followed by a guarded metadata PATCH; metadata failure retries only that PATCH and retains the uploaded asset. Transfer retries reuse their idempotency key. Local previews use revoked-on-cleanup blob URLs, with a decode-error placeholder. Site changes abort transfers and ignore stale results. See the [upload UI verification](../qa/media-upload-ui-2026-11-12/report.md).
