# Visual revision publication verification

Verified on 2026-11-12. [Contract](../../architecture/visual-publication.md) and
[OpenAPI](../../api/openapi.yaml) describe revision-bound review/release, private
preview, conditional headers and cache policy.

## Evidence

| Run | Coverage |
| --- | --- |
| [Clean-database backend regression](backend.xml) | Visual release/drafts, existing Page/Post workflow, working drafts, revisions, restore, permissions and schema validation |
| [Final visual transaction regression](final.xml) | Reviewed revision binding, unavailable Gallery, private preview/images, restoration, cache commit/rollback, upgrade rehearsal, atomic reference promotion |
| [Admin and private image proxy regression](admin.xml) | Frozen review dialog, exact preview ETag on publication, scoped authenticated proxy, no-store on success/denial/failure, legacy Page/Post controls |
| [Shared renderer regression](portal.xml) | Public/private image URL isolation, preview retry, visual fixtures and legacy rendering |

The main backend run passed 86 tests, the focused visual transaction run passed
20, and the admin/proxy run passed 45. All recorded runs have zero failures.

Workspace TypeScript, OpenAPI validation,
model drift and Django system checks pass. The migration is rehearsed both on a
clean database and through the pre-provenance schema with existing APPROVED
content. The local development database applies the same migration.

## Revision-bound and asset evidence

The API workflow scenario submits and approves a saved layout, returns it to
DRAFT, changes its ordered tree and attempts publication with both the old
approval token and the new unapproved draft token. Both attempts fail. A fresh
submission and review then publishes the new approved revision. Its snapshot
links a different approval/revision from the old one.

The private preview test verifies anonymous and foreign access fail, unreferenced
images are denied, and CMS reviewers can access only images in the selected
immutable revision. Preview JSON and images are private/no-store and vary on
credentials/Host. Reading historical preview does not advance public generation.

The Gallery fault scenario publishes an initial layout, approves a separate
working draft with a new Gallery and removes that Gallery image's delivery
sources from the isolated test storage. Publication fails. The previous anonymous
response, snapshot, PUBLIC reference set and generation are unchanged.

A positive fallback test removes one derivative while retaining its verified
private original. Publication and scoped preview still succeed through the
documented original-regeneration policy.

Another scenario publishes reversed columns and two ordered slides, then edits
a later private draft. Private preview differs while anonymous output remains
the approved tree. Restoring the private draft creates a DRAFT revision and
leaves the publication untouched.

## Atomic and cache evidence

A fault is injected after a replacement publication snapshot and new PUBLIC
references exist inside the transaction. The exception rolls back the live body,
snapshot, reference set and generation, leaving the working draft APPROVED.
A separate database-guard test injects changed presentation after approval and
confirms the publication is rejected.

The cache test warms the prior generation, publishes inside an outer transaction
and verifies invalidation has not run before commit. Rollback preserves that
entry and creates no snapshot. Committing the same release invalidates the entry
after commit. Existing transaction-wrapped tests now explicitly execute captured
commit callbacks; the new transaction test checks real commit and rollback.

The upgrade rehearsal caught pending deferred FK events blocking index creation
after history backfill. The migration now flushes those checks before deferred
index creation, and the rehearsal passes. Fault injection also caught workflow
cleanup trying to query an aborted transaction; cleanup now preserves the original
failure and lets the enclosing transaction roll back.

Evidence consists of API/transaction integration and component/renderer tests.
It does not claim a separate browser-automation run.
