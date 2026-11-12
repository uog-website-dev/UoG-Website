# Private image derivatives and delivery

## Formats and resource policy

Supported PNG, JPEG and WebP uploads are decoded, verified and checksum-matched
before image processing. Each successful image job produces two pixel-only WebP
variants, retaining aspect ratio without upscaling:

| Variant | Maximum long edge | Use |
| --- | --- | --- |
| thumbnail | 320 px | Library cards, picker thumbnails, small-screen public images |
| display | 1280 px | Larger responsive public images |

Policy `webp-v1` uses WebP quality 82, method 4, exact alpha, with EXIF/ICC and
original container metadata discarded. A new pixel-only image is encoded rather
than forwarding original bytes. Original technical metadata/ownership remain
immutable. Legacy unknown optional dimensions are not treated as a checksum
mismatch; derivative dimensions are recorded independently.

Existing upload limits remain: 20 MiB hard stream cap, 40 million decoded pixels,
single frame, and the approved format allowlist. Each derivative is additionally
bounded by MEDIA_DERIVATIVE_MAX_BYTES (8 MiB default). The worker has a 45-second
soft/60-second hard task limit. S3 uses 5-second connect/15-second read timeouts
and one transport attempt; retry policy is owned by the durable job, not hidden
provider retries. PDF/text processing still validates originals but creates no
image variants.

## Identity, commit and duplicate delivery

Upload commit creates an asset and QUEUED MediaProcessing row in the same guarded
transaction. Celery dispatch uses `transaction.on_commit`; no uncommitted asset
is processed. The existing five-minute reconciliation task is the durable outbox
and also backfills supported legacy image assets without a processing row.

Worker lookup always reloads the asset's Site and lifecycle. Missing UUIDs are
no-ops. ARCHIVED assets or Sites never publish derivatives or become READY. The
asset foundation forbids physical identity deletion; archive is the supported
removal lifecycle. A later explicitly restored asset/Site is a separate user
operation, not resurrection by an old task.

MediaProcessing is one-to-one with the asset. Claims increment the durable
attempt count, use a new fencing token and a 90-second default lease. A live
claim blocks duplicate work; expired claims can recover after worker death.
Finalization rechecks Site, asset status and token under the common hierarchy
transaction before writing variants and committing READY. Both derivative rows,
job READY and asset READY commit together. Partial object writes cannot make an
asset selectable.

Each object key is server-generated and deterministic:
`platform-private:sites/<site>/derivatives/<asset UUID>/<original SHA256>/webp-v1-<variant>.webp`.
The database enforces unique `(asset, variant)` and unique storage references.
A READY duplicate task returns the existing result without another PUT. A retry
uses the same versioned key and bytes, not a second derivative identity. Old or
failed tasks never delete deterministic keys, avoiding deletion of a successful
retry. Partial/failed derivative objects remain private and retained; this change
does not introduce a garbage collector or terminal-job reprocess UI.

Migrations 0006-0008 add processing/derivative tables, audited ownership guards,
worker-only READY to REJECTED on terminal processing failure, monotonic attempt
counts, terminal-state reset protection and a retained retry ledger. Interactive
metadata APIs cannot reset counters, alter derivatives or promote an uploaded
PENDING asset.

## Retry and visible outcomes

Default MEDIA_PROCESSING_MAX_ATTEMPTS is 3 (two Celery retries). Transient I/O
failures use MEDIA_PROCESSING_RETRY_SECONDS (10 seconds) with exponential delay
(10 then 20 seconds by default). The database budget survives broker redelivery,
reconciliation and worker restart. A killed final attempt becomes FAILED with
RETRY_EXHAUSTED after its lease expires. Reconciliation does not reset or dispatch
terminal jobs. Corrupt, checksum-mismatched or resource-limit originals fail
permanently on the first attempt; missing originals also fail permanently.

The asset remains PENDING until its required variants are stored. Terminal
failure sets REJECTED and a FAILED processing record; it never leaves a selectable
broken image. Public metadata exposes processing_attempts and a sanitized
processing_error_code (INVALID_IMAGE, ORIGINAL_MISSING, PROCESSING_IO or
RETRY_EXHAUSTED), never an exception string, credential or object key.

Thumbnail status is READY, PROCESSING, FAILED, NOT_GENERATED (unprocessed legacy
image), NOT_APPLICABLE (non-image), or UNAVAILABLE (archived image). The ready-image
query excludes active/failed processing rows even for legacy READY assets.
Placement services and database guards enforce the same boundary. Task delivery
results include asset ID, lifecycle status and processing outcome; Celery delivery
success alone does not imply image processing success; inspect the durable state.

## Private and public lookup

- `GET /api/v1/sites/{site}/assets/{uuid}/image/?variant=thumbnail|display` requires
  current Site media-view permission and effective MEDIA. Defaults to thumbnail.
- The Admin image proxy at `/admin/sites/{site}/media/{uuid}/image` keeps bearer
  credentials server-side and forwards image bytes with no-store headers.
- `GET /api/v1/site-context/media/{uuid}/?variant=thumbnail|display` derives the
  Site only from Host, requires effective MEDIA and PAGES, and checks a reference
  in a currently published PUBLIC/UNLISTED Page's latest immutable publication
  snapshot. Defaults to display. Draft-only, hidden, unpublished and foreign-Site
  assets return 404. Asset IDs are not themselves public authorization.

All successful bytes are image/webp. Strict Accept: image/webp is supported; error
envelopes remain JSON. Original bytes and storage references are never returned.
List/detail expose only a scoped thumbnail_url, status, alt text and metadata.

Library cards and the shared Image/Slider/Gallery picker use private thumbnails
and poll processing status. A failed preview shows a placeholder and disables
selection until refresh; an updated asset/status can retry its preview. The Page
renderer accepts only same-Site UUID references and uses a picture element:
thumbnail below 600 px, display otherwise. Unavailable images retain an alt-text
fallback. A Site/asset change remounts the image rather than retaining another
asset's failed state or source.

## Missing-derivative fallback and caching

Lookup first checks the exact owned deterministic derivative and verifies its
recorded length/SHA-256. A missing row/key, corrupt derivative or derivative read
outage falls back to the same asset's original: stream within the byte limit,
verify original checksum/MIME/known dimensions, fully validate pixels, then
re-encode the requested bounded WebP variant in memory. This read-only fallback
does not mutate storage or mark a job ready. X-Media-Fallback records either
stored-derivative or original-regenerated.

If that original is missing/invalid, return 404; storage outages return 503.
There is no filename-based lookup, other-Site substitution, guessed object path,
public original or signed URL. Current lifecycle is rechecked after I/O.
Responses are `Cache-Control: private, no-store` and vary by Host/Authorization/
Cookie. This deliberately prioritizes lifecycle/scope checks over CDN caching;
repeated missing-derivative requests pay bounded regeneration cost.

## Verification and deployment

See [Celery duplicate/retry and fallback evidence](../qa/media-thumbnails-2026-11-11/report.md)
and the [OpenAPI contract](../api/openapi.yaml). Local migrations were applied and
workers restarted. Production deployment must include migrations 0006-0008 and
updated backend/worker/Admin/public bundles. No new bucket or public ACL is needed.
Advanced Slider/Gallery widgets remain absent; their shared picker/reference
boundary is covered, while actual widget UI wiring remains future work.
