# Visual draft save/reload verification

Verified on 2026-11-12. The implementation extends the existing scoped Page
service and working-draft flow; it adds no independent builder model, version
counter or migration.

## Contracts and examples

- [Load/save, version, public isolation and error binding policy](../../architecture/visual-draft-persistence.md)
- [Generated OpenAPI](../../api/openapi.yaml)
- [Complete-tree request](save-request.json)
- [Stale-write error example](conflict-response.json)
- [Node/item-bound validation example](validation-response.json)

The request examples use fixture asset UUIDs. Replace them with ready image IDs
owned by the active Site before sending to a live API. They are not storage
paths or public object URLs.

## Evidence

| Run | Coverage |
| --- | --- |
| [Clean-database CMS and API regression](backend.xml) | 42 passed: Page authoring, working drafts, revision history, documentation and visual draft tests |
| [Final transaction regression](final.xml) | 9 passed: complete tree, public isolation, foreign/malformed references, conflict race, rollback, working-draft opening and access/module gates |
| [Typed actions and Admin editor/picker regression](admin.xml) | 29 passed: caller ETag, complete-tree payload, stale Slider without retry, numeric item error binding, existing editing |
| [Shared visual and legacy portal renderer](portal.xml) | 68 passed: shared widgets, scoped media, layout validation and legacy rendering |

OpenAPI generation validates with warnings treated as failures. Its request
schema requires the full `visual_layout` field even though the method is PATCH;
the stale-write response is 409, not the generic Site endpoint's 412.
Workspace TypeScript checks pass.

The transaction tests assert:

1. Reloaded structure equals the submitted tree, including reversed slide order
   and stable widget/item IDs. All reference rows point to the saved revision.
2. Converting and saving a visual working draft leaves the published Page's
   legacy body, immutable publication payload, PUBLIC inventory and anonymous
   JSON response unchanged.
3. A foreign asset in the second slide returns the Slider ID, slide ID and
   integer item position. Metadata, revision count and reference inventory stay
   unchanged; no foreign asset metadata is returned.
4. Two concurrent API requests from separate editor identities with the same
   ETag yield exactly one 200 and one 409. The winner's complete Slider payload
   and exact asset/item reference set persist, with one new revision.
5. An injected failure after revision/reference insertion rolls back the body,
   revision and references. The test confirms new references existed inside the
   failing transaction before checking rollback.
6. Missing/stale preconditions, cross-Site requests, reviewer writes and disabled
   PAGES gates fail. Legacy flat blocks still load and save through the normal
   Page API; explicit visual conversion retains the flat body in prior history.

The first broad run reused a flushed test database missing migration-seeded
module rows. Recreating the test database restored that baseline. The same run
also caught an OpenAPI 412 advertisement; the endpoint contract now correctly
documents 409. Final evidence files contain passing reruns.
