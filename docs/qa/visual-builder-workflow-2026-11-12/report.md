# Visual Builder drafts, private preview and CMS workflow — 2026-11-12

Site Editors save visual drafts with typed APIs, see draft-state indicators,
preview the current editing revision at desktop/tablet/mobile widths, and use
server-advertised CMS workflow actions. Conflicts retain local input and offer
reload or adopt recovery. Session undo/redo stays separate from CMS history.

## Contracts and implementation

- Persistence: [visual-draft-persistence.md](../../architecture/visual-draft-persistence.md)
- Publication/preview: [visual-publication.md](../../architecture/visual-publication.md)
- Builder shell: [visual-builder-shell.md](../../architecture/visual-builder-shell.md)
- Workspace: [visual-builder.tsx](../../../frontend/apps/admin-web/src/sites/visual-builder.tsx)
- Viewport chrome: [visual-builder-preview.tsx](../../../frontend/apps/admin-web/src/sites/visual-builder-preview.tsx)
- Coverage: [workflow.xml](workflow.xml)

## Evidence attachments

| Artifact | Role |
| --- | --- |
| [viewport-fixtures.json](viewport-fixtures.json) | Desktop/tablet/mobile widths and revision binding |
| [conflict-recovery.json](conflict-recovery.json) | Concurrency UX + navigation guard + tested revision tokens |
| [workflow.xml](workflow.xml) | Vitest JUnit (builder, Pages, workflow controls, page-actions) |

## Acceptance mapping

| Criterion | Status | Evidence |
| --- | --- | --- |
| Saved draft survives reload and stays private | **PASS** | Save adopts canonical tree/ETag; message states public revision unchanged |
| Failed save or conflict preserves local edits | **PASS** | 409 keeps canvas content + Unsaved changes; Reload/Adopt offered |
| Role-appropriate workflow actions show authoritative state | **PASS** | `available_actions` → ContentWorkflowButtons; status/chip update after submit |
| Accordion/new content in private preview at all widths; public unchanged | **PASS** | Private preview dialog viewport chrome on editing revision |
| Role handoff uses the saved draft | **PASS** | Workflow disabled while dirty; submit uses saved ETag |

## Recorded interaction results

| Case | Result |
| --- | --- |
| Save → Private preview Desktop/Tablet/Mobile | Editing revision shown at 1280/768/390 |
| Concurrent 409 → Reload server draft → Save | Local layout retained; next save uses refreshed ETag |
| Unsaved Back to Pages | Confirm guard; cancel keeps workspace |
| Save → Submit | Status becomes IN_REVIEW; Review revision chip |

## Results

| Verification | Result |
| --- | --- |
| Builder + Pages + workflow + page-actions | 48 passed ([workflow.xml](workflow.xml)) |

Tested fixture IDs: Site `11`, Page `00000000-0000-4000-8000-000000000001`,
revisions `1` → `2` (save) → `3` (submit); conflict reload `9` → reconcile `10`.

Advanced portal browser E2E remains waived consistent with prior builder packs;
component coverage exercises save, viewport preview, navigation guard, conflict
recovery and reviewer handoff against the shared CMS contracts.
