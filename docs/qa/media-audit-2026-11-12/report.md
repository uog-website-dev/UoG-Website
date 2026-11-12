# Full media implementation audit ? 2026-11-12

**Result: four reproduced defects remain. The implementation is substantial, but
it does not yet meet all media acceptance criteria.** This is an audit of the
current working tree, including uncommitted and untracked implementation files.
No production code was changed during this audit.

## Findings

### F1 ? P1: accepted asset IDs can bypass deletion protection

Locations: `backend/apps/cms/blocks.py:198?203` and
`backend/apps/media/migrations/0010_reference_inventory_and_removal.py:18?21`.

`check_image_ref` accepts the 32-character UUID form through `uuid.UUID`, checks
that it names a ready owned image, but returns the original unhyphenated string.
`media_extract_uses` only recognizes the hyphenated UUID form. Consequently a
successfully saved Image block can reference an existing asset with no DRAFT
inventory row. `remove_asset` then accepts deletion despite that saved reference.
The missing inventory also prevents publication delivery for this spelling.

Reproduced using an uploaded/processed image, saving
`sites/<site>/assets/<asset.uuid.hex>`, observing zero usage rows, accepting
removal, and verifying that the Page still contains that asset identifier.
The normal Image picker generates hyphenated UUIDs, so this is reached through
the accepted structured-JSON/API path rather than the normal picker insertion.

Remediation: canonicalize Site IDs and UUIDs on write; make extraction recognize
all previously accepted UUID representations and rebuild current reference sets
in an additive migration. Add API/domain tests proving every accepted form is
indexed and prevents deletion. Keep immutable revision snapshots intact.

Evidence: `test_noncanonical_uuid_reference_is_not_protected` in
[backend diagnostics](backend-reproductions.xml) and [reproduction source](backend-reproductions.py.txt).

### F2 ? P2: object-storage I/O holds the platform-wide write lock

Locations: `backend/apps/media/removal.py:61?73` and
`backend/apps/media/processing.py:153?161`; shared lock implementation:
`backend/apps/organizations/hierarchy_lock.py:18?21`.

Cleanup runs its S3 DELETE calls inside `hierarchy_write`. Derivative processing
also performs its PUT calls inside `processing_write`, which acquires the same
singleton hierarchy guard. Slow storage therefore holds up unrelated CMS, Site,
organization and IAM writes across Sites, rather than only this asset's work.
The adapter's finite network timeouts limit individual operations, but several
operations or queued jobs can create substantial platform write delays.

Reproduced by pausing cleanup's first storage DELETE and attempting to acquire
the hierarchy guard on another PostgreSQL connection. The unrelated writer hits
its 150 ms lock timeout; releasing storage lets cleanup finish normally.

Remediation: separate short claim/finalization transactions from storage I/O.
Preserve claim fencing, deletion races and durable reconciliation for late PUTs;
simply moving PUT outside the transaction would introduce orphan-object races.

Evidence: `test_storage_cleanup_blocks_unrelated_platform_writes` in
[backend diagnostics](backend-reproductions.xml).

### F3 ? P2: cancelling a pending picker confirmation still changes the field

Location: `frontend/apps/admin-web/src/sites/media-picker.tsx:116?140`.

`confirm` awaits the detail recheck and then calls `onConfirm` without verifying
that this dialog/confirmation is still current. Escape calls `cancel` even while
the detail request is pending. Closing the dialog resets UI state but does not
invalidate the pending async operation. When the response arrives, it still
applies the selection after cancellation. Site changes/unmounts need the same
stale-confirmation fence; keying the library alone does not fence this callback.

Reproduced by deferring `getSiteMedia`, selecting an image, pressing Escape,
closing the dialog, and resolving the request. Both `onCancel` and `onConfirm`
are called. Existing cancellation tests close before selection, so do not cover
this pending-confirmation race.

Remediation: invalidate a confirmation generation on cancel, close, Site change
and unmount; only the current open dialog may apply its result. Catch rejected
server-action promises and present a retryable error rather than an unhandled
rejection. Test cancellation and Site change while confirmation is pending.

Evidence: `audit: a pending confirmation still applies after Escape` in
[frontend diagnostics](frontend-reproductions.xml) and [reproduction source](frontend-reproductions.tsx.txt).

### F4 ? P2: editing an Image silently removes its caption

Locations: `frontend/apps/admin-web/src/sites/content-media-builder.tsx:60?69`
and `frontend/apps/admin-web/src/sites/site-pages.tsx:988?999`.

The CMS Image block schema supports `caption`, but `ImageBlockValue` and
`parseMediaBlock` omit it. The editor passes this reduced object to
`MediaBlockEditor`; changing its alt text or selected image serializes the reduced
object back into the Page. An existing caption/credit is silently lost.

Reproduced by parsing a valid Image containing a caption and observing the parsed
editor value has no caption. The Page's existing onChange path saves precisely
that value. Gallery/Slider item captions are preserved; this concerns standalone
Image blocks.

Remediation: include and preserve supported optional Image fields in the typed
value/parser, then verify alt/image edits retain caption through save/reload.

Evidence: `audit: editing an Image through the typed editor strips its caption`
in [frontend diagnostics](frontend-reproductions.xml).

## Checks run

| Area | Current result | Evidence |
| --- | --- | --- |
| Media DB/API/service/upload/worker/reference/removal suites | 71 passed, no skips; real MinIO enabled | [backend.xml](backend.xml) |
| Library, picker, picker/save and Site Administration frame | 35 passed | [admin.xml](admin.xml) |
| Portal Page rendering/media | 9 passed | [portal.xml](portal.xml) |
| Typed media client | 4 passed | [client.xml](client.xml) |
| New backend defect diagnostics | 2 reproduced | [backend-reproductions.xml](backend-reproductions.xml) |
| New frontend defect diagnostics | 2 reproduced | [frontend-reproductions.xml](frontend-reproductions.xml) |
| Workspace TypeScript checks | All five package checks passed | Docker workspace `pnpm typecheck` |

Diagnostic assertions intentionally describe the faulty behavior: a passing
diagnostic confirms the defect, not correctness. Their source is archived here;
temporary test-discovery files were removed after execution. Existing production
implementation and existing regression tests were not edited by this audit.

The current tests provide good coverage of canonical identity, private streaming
uploads, configured MIME/size policy including PDF, retries, duplicate workers,
Site selectors and metadata immutability, deterministic pagination, missing-image
fallback, current draft/publication retention and concurrent deletion/linking.
No direct foreign-Site disclosure was observed in the exercised scenarios.
Passing these tests does not cover the four paths above.

## Definition-of-Done evidence gap

The browse/manage/picker packs mostly demonstrate component + service/API paths.
Their reports explicitly say full authenticated Keycloak ? Admin ? worker browser
E2E and advanced builder browser coverage are unavailable. The standalone browsing
fixture uses mocked transport and does not prove the deployed authentication,
Site selector, upload proxy and worker flow together. No user-approved waiver was
established in this audit. Record this as outstanding coverage, rather than
claiming every named story E2E and responsive/browser requirement is complete.

## Recommended order

1. Close the UUID/inventory mismatch and backfill missing current references.
2. Remove object-storage I/O from the shared write-lock critical sections safely.
3. Fence stale picker confirmations and preserve Image captions.
4. Add these regressions and run the named authenticated browser workflows.
