# Asset delivery and safe removal verification ? 2026-11-11

Implemented current draft/publication inventories, nested Image/Slider/Gallery
traversal, serialized link/removal guards, immutable deletion tombstones,
post-commit cleanup outbox, Site-scoped delivery and library deletion controls.

## Contracts and constraints

- [Delivery, reference granularity, lock order, cleanup and cache policy](../../architecture/media-removal.md).
- [Structured block schema](../../../backend/apps/cms/schemas/blocks-v1.schema.json) and [builder contract](../../architecture/cms-content-blocks.md).
- [OpenAPI inventory, DELETE, cleanup state and delivery routes](../../api/openapi.yaml).
- [Schema additions](../../../backend/apps/media/migrations/0009_mediaasset_deleted_at_mediaasset_deleted_by_and_more.py), [reference/removal DB guards and backfill](../../../backend/apps/media/migrations/0010_reference_inventory_and_removal.py), [additive CMS block migration](../../../backend/apps/cms/migrations/0013_media_repeater_blocks.py).
- [Lifecycle, race, migration rehearsal, MinIO and cache test implementation](../../../backend/tests/test_media_removal.py).

## Evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Full backend, fresh DB with MinIO | 754 passed, 2 skipped, 1 corrected test setup failure | [Initial JUnit](backend-full-initial.xml) |
| Full-run failed-case rerun | 1 passed; aggregate coverage 755 passed, 2 skipped across runs | [Final rerun](backend-full-rerun.xml) |
| Final schema/docs API regression | 14 passed | [JUnit](schema.xml) |
| Repeated real-connection races | 2 passed; both winning orders observed | [JUnit](races.xml), [outcomes](races.json) |
| Draft/public inventory and cache behavior | 409 protection, 202 removal, generation 2 to 3 | [Captured result](reference-cache.json) |
| Dedicated removal integration, including real MinIO | 10 passed | [JUnit](backend-focused.xml) |
| Library deletion, inventory failure, upload/picker regressions | 11 passed | [JUnit](library.xml) |
| Page editor/workflow/working draft regression | 20 passed | [JUnit](builder.xml) |
| Portal media including nested Slider/Gallery reuse | 9 passed | [JUnit](portal-ui.xml) |
| Typed client filters, metadata and removal routes | 4 passed | [JUnit](client.xml) |
| Full frontend before final added failure-state test | Admin 405, portal/UI 92, client 163 passed | Console run; final changed paths covered above |
| Workspace typechecks | All five passed | Local Docker workspace run |
| Django check, model drift, OpenAPI validation | Passed | No issues; no migration drift; fail-on-warning schema generation |
| Local deployment | CMS 0013, media 0009?0010 applied; worker restarted | Cleanup, process and reconcile tasks registered |

The initial reused backend database had an empty migration-seeded catalogue;
that run was discarded and the full suite was restarted with `--create-db`.
A new storage-I/O test initially attempted an invalid Page visibility value,
which cannot withdraw publication. It now uses the real guarded unpublish
transition and passes in the dedicated final run and the full-run failed-case rerun.
The initial full run had already imported the earlier test body; its report is
retained unchanged. The final schema run covers the subsequent typed inventory
serializer and named OpenAPI enums. No permission or production
module settings were changed to make tests pass.

## Reference retention and race

The nested publication test publishes a Slider inside two sections, opens a
working draft, removes the slide and verifies one PUBLIC inventory row still
names `hero / slides.asset_id / slide-1`. DELETE returns 409, changes no cache
generation and leaves anonymous delivery working. Publishing the removal clears
the live set and makes anonymous delivery 404, while authorized private preview
still works. A remaining MANUAL placement also blocks deletion until detached.
Accepted deletion returns 202 and immediately makes list/detail/picker/preview
404 or empty. Repeat DELETE returns the same job; restoring its tombstone fails.

Two real PostgreSQL connections race deletion against manual linking and against
creation of a nested draft reference. In each case exactly one operation commits;
a deleted asset has zero references, or the surviving asset has its reference.
An outer rollback leaves bytes, READY state and no cleanup job/dispatch intact.

A four-slot document reuses one asset for Image, Slider and two Gallery items.
The inventory has four rows and storage identity remains singular. Removing all
current draft uses releases protection. Portal rendering also removes a Slider
while the Gallery still resolves the same UUID.

## Storage, delivery and caches

Fault injection fails cleanup deletion, verifies RETRY and immediate picker
exclusion, then recovers storage and reaches DONE. Repeated cleanup is a no-op.
Actual MinIO integration removes exactly the accepted asset's original and two
derivative objects, preserves another active identity, and verifies idempotence.
The durable ledger and periodic reconciliation recover broker/transfer failures.

Host-resolved anonymous delivery is denied before publication, allowed after
publication and denied after publication removal. Foreign Host and private Site
requests fail. Image responses/errors are no-store and vary by Host and
authorization. Eligibility is rechecked after storage I/O: withdrawing publication
during the read returns 404. A warmed Page cache's generation advances on accepted
removal, while rejected removal does not advance it.

## Migration rehearsal and operational scope

The dedicated rehearsal creates live nested media and an edited working draft,
rolls the isolated test database back to media 0008 / CMS 0012, then migrates
forward. It verifies the PUBLIC set is backfilled, the removed draft use stays
absent, and existing revision snapshots are byte-for-byte JSON-equivalent.
The fresh full database run exercises installation from zero.

The Page editor remains a structured JSON editor with ready-image picker
insertions for Image/Slider/Gallery. Nested reference and portal behavior are
covered at service/API and component levels; no full browser drag-and-drop
builder regression is claimed. Originals stay private; this story does not add
public raw document downloads. Storage cleanup retains audited identity records.
Production needs the migrations and updated backend/worker/frontend deployment.
