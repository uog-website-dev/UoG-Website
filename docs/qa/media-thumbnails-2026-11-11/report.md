# Image thumbnail and processing verification - 2026-11-11

Implemented private 320 px thumbnail and 1280 px display WebP variants, durable
processing claims/retries, terminal failure reporting, scoped library/picker
previews, published-only responsive Page images and verified-original fallback.
Original storage remains private and object keys never enter media metadata URLs.

## Contracts and implementation

- [Formats, retry budget, fallback and deployment policy](../../architecture/media-thumbnails.md).
- [OpenAPI private/public image contract](../../api/openapi.yaml).
- [Worker/claim/fencing implementation](../../../backend/apps/media/processing.py) and [Celery tasks](../../../backend/apps/media/tasks.py).
- [Scoped image delivery](../../../backend/apps/media/delivery.py).
- [Derivative/processing schema](../../../backend/apps/media/migrations/0006_mediaprocessing_mediaderivative.py), [ownership/audit guards](../../../backend/apps/media/migrations/0007_processing_integrity.py) and [retained retry budget](../../../backend/apps/media/migrations/0008_processing_retry_retention.py).
- [Worker, retry, duplicate and fallback integration cases](../../../backend/tests/test_media_derivatives.py).

## Verification results

| Check | Result | Evidence |
| --- | --- | --- |
| Full backend, with real MinIO tests enabled | 744 passed, 2 skipped | [JUnit](backend-full.xml) |
| Final derivative, API/schema and module regressions | 32 passed, 1 skipped | [JUnit](backend-focused.xml) |
| Initial dedicated derivative/MinIO integration | 10 passed; repeated in final focused run | [JUnit](minio-integration.xml) |
| Full Admin regression | 405 passed | [JUnit](admin.xml) |
| Final library/image proxy checks | 11 passed | [JUnit](library-proxy.xml) |
| Shared portal/UI regression | 92 passed | [JUnit](portal-ui.xml) |
| API client regression | 163 passed | [JUnit](client.xml) |
| Workspace typechecks | All five package checks passed | [Summary](verification.json) |
| Django / migration drift / OpenAPI | No issues, no model drift, validated with fail-on-warning | [Summary](verification.json) |
| Local migration and workers | Media 0006-0008 applied, worker/beat restarted, both tasks registered | [Summary](verification.json) |

The full backend run preceded the final strict WebP content-negotiation helper,
SQL nested-publication lookup and explicit task result shape. The final focused
run covers these changes and includes real Celery eager retries and real MinIO.
The full Admin run preceded a small preview-key/input-reset improvement, covered
by the final library/proxy run. Both portal and workspace typechecks include the
final public image behavior. Backend skips are existing code-only-container
checks for Markdown documentation outside the container; no MinIO test was
skipped in the full or final focused run.

An initial full run found a stale CMS route-inventory assertion after adding the
public image route. The assertion was corrected and the full rerun above passed.

## Duplicate delivery and retry budget

The duplicate integration invokes the same production job twice and verifies
exactly one database row per thumbnail/display variant, identical keys/metadata,
no second successful PUT, stable READY status and one durable attempt. A separate
two-thread duplicate test verifies that simultaneous claims also produce one
result per variant. A live lease fences another delivery; an expired killed
final attempt becomes FAILED/RETRY_EXHAUSTED without another decode or write.

Fault injection writes a private partial thumbnail then raises on every
attempt. Two Celery retry calls are issued with max_retries=2. The third attempt
records FAILED/PROCESSING_IO and REJECTED. No derivative metadata is committed,
no ready-image result is returned and the image endpoint is 404. A duplicate or
reconciliation pass does not reset the attempt count or dispatch terminal work.
SQL reset/deletion attempts against the retained retry ledger are rejected.

The real Celery eager retry test exercises `Task.apply`, not just a mocked retry
callback: it performs three attempts, returns an explicit FAILED processing
outcome, and a duplicate returns the same outcome without more work. This is
in-process Celery/PostgreSQL integration, not a distributed-broker outage test.
Task delivery completion is distinct from processing success; the durable
processing state and explicit result carry the terminal outcome.

Corrupt originals and a configured pixel-limit violation fail permanently on
attempt one. Missing asset UUIDs are no-ops. Archiving a Site during decode stops
publication; an archived READY asset remains archived on stale delivery. The
asset model does not support physical deletion, so archive is its removal
contract and missing-ID behavior is tested independently.

## Fallback and institutional boundary

The [actual MinIO result](minio-fallback.json) records two deliveries, one durable
attempt, two distinct variant rows, anonymous object access 403 and a scoped
thumbnail response changing from stored-derivative to original-regenerated after
the thumbnail object is removed. The returned fallback is decoded as WebP and
remains no-store. Test-created originals/derivatives are cleaned up by their
exact generated keys.

Private and Host-routed public integration removes both variants after successful
processing. Private picker lookup and a nested published Page reference both
return verified regenerated WebP. Requesting the UUID through another Site/Host
returns 404, even with an identically named foreign image. The foreign Site's
own unpublished asset is also 404 publicly. Unpublishing the Page removes public
access while authorized private preview still works. Removing the original
makes both routes fail closed with 404. Strict Accept: image/webp works for bytes;
its errors remain JSON. No guessed path, other-Site asset or public original is
used as fallback.

Frontend tests verify a scoped private proxy source, failed-preview placeholder
and disabled selection, visible terminal processing failure, responsive public
variant sources, alt-text fallback and correct image reset when the asset/Site
changes. The shared Page editor and portal regressions remain green.

## Operational scope

No bucket ACLs, module activation settings or user assignments were changed.
Original bytes remain private; public routes require current MEDIA/PAGES and a
reference in a live PUBLIC/UNLISTED publication snapshot. Responses are no-store
and Host/authorization scoped. Partial failed derivative objects remain private
and retained at deterministic keys; garbage collection/reprocess UI are separate
work. Production must deploy migrations 0006-0008 and updated backend/worker/
Admin/public code. Existing local workers were restarted with this implementation.

Advanced Slider/Gallery widgets do not exist in this checkout. Their shared
ready-image and placement boundary is covered; a widget-specific browser
regression is not claimed.
