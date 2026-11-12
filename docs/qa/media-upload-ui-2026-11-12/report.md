# Media upload and library UI verification

Verified locally on 2026-11-12. Migration `media.0012_asset_editable_metadata`
was applied successfully; Django reports no model drift or system-check issues.
OpenAPI generation passed validation with warnings treated as failures; the
[current contract](../../api/openapi.yaml) includes the metadata fields.

## Behavior

- Responsive image cards and document placeholders, search/filter toolbar,
  grid/list layouts and image detail previews.
- Keyboard-accessible drag/drop or multiple-file browsing, up to 20 queued
  files with two concurrent transfers. Each file has its own editable media
  name, comma-separated categories and alt text, status and retry control.
- The existing secure streaming upload returns an asset ID. A guarded metadata
  PATCH saves the queue fields. If this second step fails, the UI explicitly
  reports that the file was uploaded and retries metadata without retransmitting
  bytes. Transfer retries retain their original idempotency key.
- Site changes abort transfers and ignore stale results. Local previews revoke
  blob URLs on removal/unmount and display a document icon on decode failure.
  Nginx permits blob URLs only in its image CSP directive.
- PNG/JPEG/WebP and PDF remain limited to 20 MiB, UTF-8 text to 5 MiB.
  Processing remains authoritative: pending/failed images cannot be selected.
  Upload alt text is capped at 255 characters for Page compatibility; the
  existing metadata API limit remains 1000 characters.
- Editable `display_name` is independent of immutable `original_filename` and
  storage identity. Existing rows display their original filename as fallback.
  Categories are labels on the Site-owned asset, not a global taxonomy: at most
  ten labels of 64 characters, deduplicated case-insensitively. A database check
  validates their JSON shape. Metadata changes retain actor/Site auditing.

## Evidence

| Check | Result |
| --- | --- |
| [Full media integration suite](backend.xml) | 84 passed, including real MinIO paths |
| [Final clean-database metadata/concurrency run](backend-final.xml) | 13 passed |
| [Full Admin component suite](admin.xml) | 435 passed |
| [Final library and upload queue suite](ui-final.xml) | 27 passed |
| [Typed media client](client.xml) | 5 passed |
| Workspace TypeScript checks | All five tasks passed |
| OpenAPI validation, migration drift, Django checks | Passed |
| Nginx configuration test and reload | Passed |

The final queue checks cover multi-file drop, per-file metadata, separate retry
identities, metadata-only retry, unsafe/oversize rejection, two-transfer bound,
Site-change cancellation and local preview cleanup/fallback. Backend tests cover
legacy names, scoped search, metadata audit, protected/foreign changes rejected
atomically and the category database constraint.

Native Chrome verification on the running Site Administration page confirmed
the redesigned library, the existing ready image and a two-file queue with
working local previews and all metadata fields. Generated fixture files were
selected locally; this visual check did not submit them as library assets.
Automated integration tests provide the upload and persistence evidence.

The initial full backend run passed but reported a lingering test-thread database
connection during teardown. The thread helper now closes its owned connections;
the final clean-database run passed without that teardown warning.

## Details and immersive image preview follow-up

The details dialog now uses a responsive preview/editor split with a larger contained image, compact file information and a clear save action. Image cards open a dark full-screen viewer with the scoped display derivative, asset name, dimensions and alt-text caption. An expand action also opens it from details, preserving unsaved fields on close. Site changes unmount the viewer. Originals remain private. Admin TypeScript and 36 library/picker/save regression tests passed, including the scoped viewer URL, Site-change reset and unsaved edit retention.

## Automatic queue completion and compact list follow-up

After a batch finishes, successfully uploaded files whose metadata was saved leave the queue automatically. A completion notice replaces the finished form, with no zero-file upload button or manual clear step. Failed transfers or metadata saves remain for retry, preserving retry identity. This does not bypass worker processing or the ready-only picker rule. List rows use compact contained thumbnails with file information and actions; normal Ready badges are omitted from both layouts, while processing/failure badges remain. Regression coverage checks automatic full-batch clearing, mixed-batch failure retention and both layout badges.
