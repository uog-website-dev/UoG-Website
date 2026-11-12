# Private media upload verification ? 2026-11-11

Implemented a Site-gated raw upload API, server-owned private keys, durable retry
identity, bounded byte validation/checksum, worker-controlled readiness, abandoned
attempt reconciliation, and the Site Media library/Page image picker.

## Contracts and implementation

- [OpenAPI upload contract](../../api/openapi.yaml): POST `/api/v1/sites/{site_pk}/assets/upload/`, policy GET, asset list/detail and state responses.
- [Configured types, limits, retry and deployment contract](../../architecture/media-uploads.md).
- [Streaming validation and lifecycle](../../../backend/apps/media/uploads.py).
- [Upload identity schema](../../../backend/apps/media/migrations/0004_mediaupload_mediauploadattempt_and_more.py) and [worker-only promotion trigger/Editor permissions](../../../backend/apps/media/migrations/0005_upload_processing_guard.py).
- [API/fault/worker integration tests](../../../backend/tests/test_media_uploads.py).
- [Library/picker component tests](../../../frontend/apps/admin-web/src/sites/media-library.test.tsx) and [same-origin streaming proxy tests](../../../frontend/apps/admin-web/src/app/sites/[id]/media-upload/route.test.ts).

## Results

| Verification | Result | Evidence |
| --- | --- | --- |
| Full backend regression | 710 passed, 3 skipped | [JUnit](backend-full.xml) |
| Final upload, catalog, two-Site and permission integration | 38 passed, including real MinIO | [JUnit](backend-focused.xml) |
| Admin regression | 397 passed | [JUnit](admin.xml) |
| Final library, picker polling and streaming proxy | 5 passed | [JUnit](library-picker-proxy.xml) |
| Shared portal/UI regression | 89 passed | [JUnit](portal-ui.xml) |
| API client regression | 160 passed | [JUnit](api-client.xml) |
| Initial dedicated MinIO/worker integration | 9 passed; repeated in final focused run | [JUnit](minio-integration.xml) |
| Workspace typechecks | All five package checks passed | Recorded in [verification summary](verification.json) |
| OpenAPI validation | `spectacular --validate --fail-on-warn` passed | [Checked-in contract](../../api/openapi.yaml) |
| Django check / migration drift | No issues / no changes | [Verification summary](verification.json) |
| Local upgrade | Media 0004 and 0005 applied successfully; seed_rbac succeeded | [Verification summary](verification.json) |
| Proxy and compose configuration | `nginx -t` and `docker compose config --quiet` passed | [Verification summary](verification.json) |
| Worker registration | `media.process_asset` and `media.reconcile_uploads` registered | [Verification summary](verification.json) |

The full suites preceded the final cleanup/commit-loss hardening, role-scoped
workspace check, decoder cases and upload error presentation. The final focused
runs cover those final changes. The full backend skips comprise two existing
code-only-container documentation checks and the opt-in real-MinIO test. The
latter passed with `RUN_MEDIA_MINIO_TESTS=1` in the focused run. New dependencies
are pinned to the versions installed and exercised in integration.

## Worker-to-picker result

`test_upload_processing_worker_and_ready_picker_have_one_identity` uploads a
valid PNG through the authenticated HTTP API with a forged Content-Type. Bytes
win: the response contains one UUID, detected image/png and PENDING/PROCESSING,
with no object key. READY-filtered inventory is empty; manual service/SQL
promotion, Page selection and Slider placement are rejected. Invoking the actual
`media.process_asset` task entry point validates private bytes and transitions
that same UUID to READY. It then appears once in the ready-only API inventory,
can be attached to both Slider/Gallery-shaped references, and an upload retry
returns the same UUID without a second asset/object attempt.

The component integration holds an image in processing, confirms no Select
button, then polls a READY response and selects that same ID. PDF documents are
excluded from the Page image picker. The production Page dialog is connected to
this shared picker and stores a scoped logical asset identifier.

This tests the actual worker entry point against PostgreSQL and object storage,
plus the frontend polling boundary. It does not claim a distributed broker to
browser end-to-end test. Broker-failure recovery is independently tested through
the real dispatcher and reconciliation task entry point, and the running local
Celery worker reports both tasks registered.

## Validation and failure evidence

The final integration covers PNG/JPEG/WebP decode and pixel limits, passive PDF
and UTF-8 text, active/malformed PDFs, SVG/HTML/executable signatures, truncated
images, byte caps while streaming independently of the request header, incomplete
transfers, anonymous and foreign-Site denial, module-off denial and Editor
workspace/upload authorization without archive permission.

Real MinIO fault injection commits PUT then loses its response and fails initial
cleanup. No asset is ready. Retrying creates a different private attempt key and
one canonical asset; reconciliation removes the abandoned object and retains the
successful retry. The worker makes the successful asset READY and anonymous
GET receives HTTP 403. Test objects are removed during test cleanup.

A separate lost-database-commit test raises after commit: cleanup detects the
committed asset, retains its bytes and lets the same key recover the same UUID.
A broker-outage test retains the PENDING outbox relation and reconciliation later
processes it to READY without duplication. Metadata tampering produces REJECTED,
and all processing states remain excluded from picker selection.

## Scope and operational notes

The new Media menu requires both platform availability and explicit Site MEDIA
activation, plus the Site media-view permission. No user assignments or Site
activation settings were created by this change. Local migrations and RBAC seed
were run; dependency installation in existing containers is temporary until
images are rebuilt. Rebuild backend and worker images plus the production Admin
bundle before deploying, restart worker/beat and reload nginx.

Advanced Slider/Gallery widgets do not exist in this checkout. Their placement
boundary is tested, and the existing Page editor uses the picker. A widget UI
browser regression is therefore unavailable. The current portal renderer keeps
its existing image-alt fallback: this story does not publish private originals,
add image renditions, signed URLs, antivirus certification or a public download
endpoint. Existing Page snapshots and legacy references remain readable; the
migration rehearsal is included in the final catalog integration run.
