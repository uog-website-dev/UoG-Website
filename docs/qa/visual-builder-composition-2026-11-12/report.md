# Visual Builder composition — pointer and keyboard — 2026-11-12

Site Editors can insert, reorder and remove layout components with pointer or
keyboard controls that share one composition model, keep stable node IDs on
moves, mint fresh IDs on section duplicate, and reject invalid drops without
mutating the tree.

## Contracts and implementation

- Layout contract: [visual-layout-contract.md](../../architecture/visual-layout-contract.md)
- Composition ops: [visual-builder-model.ts](../../../frontend/apps/admin-web/src/sites/visual-builder-model.ts)
  (`moveRow`, `reorderRowsByIds`, `moveWidget`, `shiftWidget`, `removeNode`,
  `duplicateSection`, `resizeColumns`, `insertWidget` with `index`)
- Interaction surface: [visual-builder.tsx](../../../frontend/apps/admin-web/src/sites/visual-builder.tsx)
  (row/widget drag-drop, ↑/↓, Add here, Duplicate, `aria-live` announcements,
  focus restore via `data-focus-id`)
- Coverage: [composition.xml](composition.xml)

## Acceptance mapping

| Criterion | Status | Evidence |
| --- | --- | --- |
| Pointer and keyboard reorder produce the same layout order | **PASS** | Row and cross-column slider moves compare ordered IDs |
| Invalid drops preserve the original structure | **PASS** | Missing/illegal targets leave `JSON.stringify(layout)` unchanged |
| Selection and keyboard focus remain predictable after edits | **PASS** | Delete focuses next sibling; moves restore `data-focus-id` control |
| Both modes place widgets in the intended column | **PASS** | `moveWidget` / `shiftWidget` + Add here index insertion |
| Reducing columns keeps content or reports clearing needed | **PASS** | Occupied trailing column blocked with clear message; empty trailing allowed |

## Recorded interaction results

| Case | Result |
| --- | --- |
| Reorder identical fixtures by keyboard and pointer-equivalent ops | Same ordered IDs |
| Invalid drop then delete focused node | Layout invariant on drop; focus → next sibling |
| Move Slider across columns; duplicate parent section; shrink populated trailing column | Stable Slider ID after move; clone IDs all new; resize blocked until cleared |

## Results

| Verification | Result |
| --- | --- |
| Composition + model + builder shell | 19 passed ([composition.xml](composition.xml)) |

Advanced portal browser E2E remains waived consistent with the shell pack;
component coverage exercises the named composition paths against the shared
layout contract.
