# Media audit fixes and preview recovery ? 2026-11-12

Fixed all four findings from the [media audit](../media-audit-2026-11-12/report.md),
plus the missing previews and repeated loading announcements reported by the user.

## User-visible recovery

The pictured upload was PENDING / QUEUED with zero attempts because the worker
and scheduler had exited. The running image contained Kombu 5.7.0 with redis-py
5.2.1; its Redis transport raised `VersionMismatch` before work could start.
Rebuilt backend/worker/beat using the repository's compatible Kombu 5.6.2 pin.
Added worker/beat `restart: unless-stopped` and explicit broker startup retries.
Worker ping now returns pong; beat is running. The queued upload completed on
attempt one and has both thumbnail and display WebP derivatives.

The library now renders reusable image previews in cards and the details dialog.
Processing assets have an explicit preview-pending placeholder; failed previews
have a retry message. Processing polling updates existing data quietly, refreshes
open detail metadata, and preserves unsaved alt text. Completed libraries stop
polling. Ready-only pickers and recent uploads have a bounded two-minute watch;
processing rows continue updating. Three background transport failures pause
updates with a refresh action. Background results are fenced by query scope and
unmount. Manual search/refresh retains its explicit loading feedback.

[Actual browser observation and runtime state](browser-verification.json):
visited the existing authenticated Informatics Media library, observed the user's
image rendered in its card, reloaded the updated frontend, opened its details,
and observed the full display preview plus READY / Thumbnail: ready. Original
storage remains private. User image bytes/screenshots are not added to the repo.

## Audit fixes

1. Image writes canonicalize compact UUIDs and numeric Site prefixes.
   [Media 0011](../../../backend/apps/media/migrations/0011_canonical_reference_inventory.py)
   recognizes old compact references and rebuilds current draft/publication
   inventories without changing immutable snapshots. Portal and editor readers
   normalize historical references to canonical delivery URLs.
2. Processing/cleanup use a shared per-asset session advisory mutex, separate from
   the global hierarchy guard. Remote PUT/DELETE operations no longer hold that
   global guard. Claim/finalization transactions remain short and fenced.
   Concurrent deletion hides immediately, but cleanup cannot finish before an
   active writer exits; a deleted asset cannot publish derivative metadata.
3. Picker confirmations are invalidated on cancel, close, Site change and
   unmount. Rejected rechecks show a retryable error. Cancellation remains usable
   while a request is pending.
4. Typed Image editor values preserve optional captions through alt/image edits.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Backend media suites, including real MinIO and four new regressions | 75 passed | [JUnit](backend.xml) |
| Final canonical mutex / reference / migration / I/O regressions | 4 passed | [JUnit](backend-final.xml) |
| CMS blocks, revisions and working drafts on a recreated DB | 25 passed, 1 existing skip | [JUnit](cms.xml) |
| Full Admin suite with maxWorkers=4 | 430 passed | [JUnit](admin-full.xml) |
| Library, picker and picker-save regressions | 33 passed | [JUnit](admin.xml) |
| Final library check after latest-upload status copy | 21 passed | [JUnit](library-final.xml) |
| Page editor and Site Administration frame | 29 passed | [JUnit](pages.xml) |
| Portal media, including historical compact references | 10 passed | [JUnit](portal.xml) |
| TypeScript workspace | Five package checks passed | Console verification |
| Django, migration drift and pip dependency checks | Passed | No issues, no drift, no broken requirements |

The CMS skip is the existing code-only-container schema-file check, not a MinIO
or media behavior skip. The final backend regression run additionally checks that
an uppercase UUID spelling maps to the same per-asset mutex.

Regression cases verify that compact UUIDs are normalized and protected; historical
reference backfill preserves revision JSON; a second connection can acquire the
platform write guard during stalled DELETE/PUT I/O; duplicate cleanup skips a busy
asset; deletion during derivative PUT never produces ready metadata or dangling
objects after cleanup. UI cases cover Escape/Site change/unmount during pending
confirmation, transport-recheck retry, caption retention, quiet processing-to-ready
updates in an open dialog, and no continuous polling of a ready catalog.

Local media 0011 is applied. Backend image and worker/beat were recreated; Admin
was restarted to load updated client code. No asset ownership, module activation
or user permissions were changed. Deployment elsewhere requires the updated
backend/worker/Admin/public code, compatible pinned dependencies and media 0011.

The first unrestricted parallel Admin run hit short DOM wait limits under load.
The final run limits workers to four and passes all 430 tests. Initial empty
content is now shown only after a successful response, and the polling regression
waits for its timer to be installed before triggering it.
