# Private Site media uploads

## Contract and supported bytes

`POST /api/v1/sites/{site_pk}/assets/upload/?filename=<original filename>` accepts
one raw `application/octet-stream` body with exact `Content-Length` and a UUID
`Idempotency-Key`. The API authenticates and checks Site `content.media.upload`,
effective MEDIA and archived-Site state before reading the request stream. It
checks again before committing the asset. It accepts neither an object path nor
technical metadata. Client Content-Type and filename extensions are not trusted.

The response is HTTP 202 with `id`, `status` and `processing_state`.
`PENDING` is exposed as `processing_state: PROCESSING`; only `READY` is selectable.
Replaying the same Site/actor/key returns the same asset, even after it is ready.
A key identifies one logical file and must not be reused for another file. A
concurrent transfer or changed filename returns 409. Different users/Sites do not
share retry identities. HTTP 400 reports invalid bytes/filename/key, 413 reports a
byte-limit violation, 401/403 deny unauthorized requests, and 503 asks the client
to retry after storage failure. Errors use the common API error envelope.

See [OpenAPI upload contract](../api/openapi.yaml) and
[validation/failure evidence](../qa/media-uploads-2026-11-11/report.md).

| Setting | Default | Meaning |
| --- | --- | --- |
| MEDIA_UPLOAD_MAX_BYTES | 20971520 (20 MiB) | Hard stream cap; PNG/JPEG/WebP image cap |
| MEDIA_PDF_MAX_BYTES | 20971520 (20 MiB) | PDF cap, also bounded by the hard cap |
| MEDIA_TEXT_MAX_BYTES | 5242880 (5 MiB) | UTF-8 plain text cap, also bounded by the hard cap |
| MEDIA_IMAGE_MAX_PIXELS | 40000000 | Maximum decoded image width ? height |
| MEDIA_UPLOAD_LEASE_SECONDS | 900 | Retry reservation lifetime |

The user requested PDF support in addition to the proposed image/text policy.
Single-frame PNG, JPEG and WebP use Pillow verification and complete image decode.
PDF uses strict structural parsing, at most 1000 pages and 50000 visited objects;
encrypted PDFs, actions/scripts, annotations, forms, attachments and rich media
are rejected. UTF-8 text rejects markup, unsafe controls and common executable
headers. GIF, SVG, HTML, Office, archives and executables are unsupported. This
is format validation, not antivirus certification or content-disarm processing.
Original-file browser preview/public download remains unavailable. Approved
private and published WebP previews are now covered by [image derivatives](media-thumbnails.md).

`GET .../assets/upload-policy/` returns effective limits/types to permitted users.
The stream reads at most the hard limit plus one byte, uses temporary disk rather
than buffering the whole request in memory, and calculates SHA-256. A truncated
transfer is rejected before object storage. Nginx request buffering is disabled
on API/Admin proxy paths. Its existing `client_max_body_size 20M` is an outer cap;
operators raising the application cap must also update the proxy cap/timeouts.
Unknown-length/chunked uploads are not supported by this WSGI contract.

## Storage, retry and reconciliation

Keys are generated only on the server:
`platform-private:sites/<site>/uploads/<upload UUID>/<attempt UUID>`.
Each attempt gets a fresh key and performs one bounded S3 PUT, so this service
creates no multipart-upload fragments. Original filenames never form object keys.
The existing bucket remains private; APIs return no original object key or URL.

`MediaUpload` uniquely identifies `(site, creator, request_key)` and links at most
one canonical asset. `MediaUploadAttempt` retains the generated reference,
WRITING/STORED/FAILED state and indexed lease expiry. Reservation and completion
lock the logical upload row. Storage transfer happens outside the Site hierarchy
transaction. Only after a complete PUT does a guarded transaction create one
PENDING asset and mark the successful attempt STORED. Failures never create a
READY asset. A lost database commit response is reconciled against canonical
asset identity before deleting anything; an unavailable DB defers cleanup.

A retry can replace an expired or failed attempt, never overwrite its key.
`media.reconcile_uploads` runs every five minutes through Celery beat. It
redispatches linked PENDING assets (a durable outbox if initial broker dispatch
failed) and deletes expired unsuccessful attempt objects under the same upload
lock. It checks canonical identity immediately before deletion and never deletes
a STORED attempt or any key owned by a MediaAsset. Attempt tombstones are retained
and revisited to catch a remote PUT completing after lease expiry/process death.
Successful retries therefore cannot be deleted by old-attempt cleanup.

## Processing and picker integration

`media.process_asset` reopens private storage, validates bytes and compares MIME,
size, checksum and dimensions with immutable catalog metadata. Only the worker
may transition an uploaded PENDING row to READY/REJECTED: both the service and an
additive PostgreSQL trigger reject manual promotion. Storage failures retry and
leave the row unselectable. Task execution has 45-second soft/60-second hard limits. Periodic redispatch
recovers stalled processing within a durable three-attempt default budget;
terminal jobs are not reset. Images require both approved WebP variants before
READY, as specified in [image derivatives](media-thumbnails.md). Repeated tasks are
idempotent and cannot create another asset. REJECTED retains private bytes and
identity for audit; it is not selected or exposed publicly.

The Site Media menu requires effective MEDIA and `content.media.view`. The
library is a Sprint 2 Site Administration section with responsive grid/list
cards, filename search, status/type filters, pagination, thumbnails, and
explicit loading/empty/error recovery. `MediaLibrary` remounts on Site change
(`key={siteId}`) so filters and in-flight results cannot leak across Sites;
`useAsync` also ignores stale completions. Uploads go through a same-origin
streaming Next route; access tokens stay server-side. The library shows upload progress, explicit processing/success/failure,
preserves the selected file and retry UUID after a recoverable failure, and
never invents a ready catalog row until acceptance. Detail editing exposes
accessible alt text; delete requires confirmation, lists nested
draft/publication/placement conflicts separately from transport failures, and
keeps the library card and metadata when removal is blocked. `MediaPickerDialog` is the shared modal picker for CMS Page editing and the
Visual Builder media fields. It mounts the library in ready-only image mode
(`ready_images=true`), re-checks eligibility on confirm via asset detail, restores
focus to the invoking control on Escape/cancel, and returns a stable asset ID
plus display metadata. `SiteImageField` / `MediaBlockEditor` apply that contract
to standalone Image nodes and per-item Slider/Gallery repeater entries so only
the targeted node changes. Site switches remount selection state. Server Page
validation rejects references unless the image is READY and owned by that Site.
Existing legacy image strings/revisions remain readable.

Standard Editors receive Site-scoped `sites.view`, media view/upload; they can
enter their own workspace but do not receive media archive or another Site's
permissions. System-role migration/seed adds permission links, never users or
role assignments. Existing administrator permissions are preserved.

Slider/Gallery placements share the same picker and reference layer; PENDING
assets are rejected and a READY identity may appear in multiple entries. The
portal renders scoped approved derivatives for published Page UUID references,
retaining alt fallback for unavailable/legacy images. No public URL is invented
for private originals.

## Deployment

Rebuild backend/worker images for Pillow and pypdf, and rebuild the Admin app for
production. Apply media migrations 0004/0005, run `seed_rbac`, restart Celery
worker/beat to register both tasks, and reload the validated nginx configuration.
The normal backend entrypoint runs migrations and RBAC seed. MEDIA still needs
platform availability and explicit activation for each Site. The local migration
and worker-registration checks are linked from the verification report.
