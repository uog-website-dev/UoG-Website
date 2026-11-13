# Visual Builder local undo/redo — 2026-11-12

Site Editors recover from composition mistakes with bounded local history.
History restores layout and selection, stays separate from CMS revisions and
approved snapshots, and resets when the editing Page or Site changes.

Dependencies: P3-FE-BUILDER-002–004.

## Contracts and implementation

- Shell contract: [visual-builder-shell.md](../../architecture/visual-builder-shell.md)
- Helpers: [visual-builder-history.ts](../../../frontend/apps/admin-web/src/sites/visual-builder-history.ts)
- Workspace: [visual-builder.tsx](../../../frontend/apps/admin-web/src/sites/visual-builder.tsx)

## History bound, keyboard and multi-Page isolation

| Rule | Value / behavior | Evidence |
| --- | --- | --- |
| Bound | 50 local steps (`VISUAL_HISTORY_LIMIT`) | `visual-builder-history.test.ts` |
| Grouped ops | Move / duplicate / resize / insert / remove = one step; inspector prop edits coalesce (~500ms) | Implementation + builder tests |
| Selection | Undo/redo restore prior `selected` id | Builder undo/redo selection test |
| Redo clear | Divergent edit after undo disables Redo | Builder divergent-edit test |
| Shortcuts | Ctrl/Cmd+Z undo; Ctrl/Cmd+Y or Shift+Z redo; ignored in inputs | Helper + UX keyboard test |
| Page/Site switch | Keyed workspace + load clears past/future | UX Page-switch test |
| CMS isolation | Undo never calls `openWorkingDraft` / CMS restore; save count unchanged | Existing workflow undo test |

## Nested-history / Slider regression notes

Moving a section (including Slider-bearing rows), undoing and redoing restores
row order and the focus id recorded with that step. Removing a repeater item is
an inspector/array mutation and undoes as a coalesced property edit on that
widget. The approved CMS snapshot is untouched until an explicit Save draft /
workflow publish path runs.

## Acceptance mapping

| Criterion | Status | Evidence |
| --- | --- | --- |
| Undo/redo restore order, fields and selection; stale redo unavailable after new edit | **PASS** | Builder component tests |
| Switching Site or Page clears prior local history | **PASS** | Page-switch keyboard test |
| Undo/redo restore complete section edits without affecting CMS snapshot; new edits clear redo | **PASS** | CMS-isolation + divergent-edit tests |

## Results

| Suite | Result |
| --- | --- |
| `visual-builder-history.test.ts` | Bound + shortcut routing |
| `visual-builder.test.tsx` | Undo/redo selection, redo clear, field shortcut isolation, Page switch |
