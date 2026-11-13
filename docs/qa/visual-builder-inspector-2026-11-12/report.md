# Visual Builder inspector — properties, media and safe links — 2026-11-12

Site Editors configure component properties through registry-driven inspector
controls for text, links, media and approved style tokens. Field errors from
client and server validation map onto the active props path. Media selection
stores eligible asset IDs without wiping sibling fields. Repeater lists support
add, reorder and remove while keeping item IDs attached. Unsafe Button
destinations block save with an actionable message and preserve draft input.

## Contracts and implementation

- Layout contract: [visual-layout-contract.md](../../architecture/visual-layout-contract.md)
- Inspector: [visual-builder-inspector.tsx](../../../frontend/apps/admin-web/src/sites/visual-builder-inspector.tsx)
- Safe-link helpers + path mapping: [visual-builder-model.ts](../../../frontend/apps/admin-web/src/sites/visual-builder-model.ts)
  (`SAFE_LINK_PATTERN`, `SAFE_LINK_MESSAGE`, `fieldMessages`, `widgetPropsPath`)
- Workspace wiring: [visual-builder.tsx](../../../frontend/apps/admin-web/src/sites/visual-builder.tsx)
  (`InspectorFields`, `mediaInvoker` / `returnFocusRef`, live canvas via `updateNode`)
- Coverage: [inspector.xml](inspector.xml)

## Evidence attachments

| Artifact | Role |
| --- | --- |
| [field-matrix.json](field-matrix.json) | Inspector field matrix (text, links, media, tokens, repeaters) |
| [repeater-tests.json](repeater-tests.json) | Slider / gallery / unsafe-button regression steps |
| [safe-link-fixtures.json](safe-link-fixtures.json) | Allowed and rejected link fixtures |
| [inspector.xml](inspector.xml) | Vitest JUnit (inspector + model + composition) |

## Acceptance mapping

| Criterion | Status | Evidence |
| --- | --- | --- |
| Changing a supported property updates the intended node | **PASS** | Controlled `onChange` → `updateNode`; text/media cases in inspector suite |
| Invalid URLs and tokens produce actionable errors | **PASS** | `SAFE_LINK_MESSAGE` on href; `validateVisualLayout` errors via `fieldMessages` |
| Media selection persists eligible asset ID and leaves other fields intact | **PASS** | Alt preserved when choosing a ready image |
| Slide title/image update in place and stay attached after reorder | **PASS** | Slider Move up + Add item keep item IDs and captions |
| Unsafe Button destinations receive a validation message | **PASS** | javascript: href mapped; Save stays blocked while `checked.ok` is false |

## Recorded interaction results

| Case | Result |
| --- | --- |
| Edit image alt, choose Site asset, reorder sibling | Asset ID updated; alt kept; same node id after `shiftWidget` |
| Submit unsafe Button URL | Draft input preserved; field shows safe-link message |
| Add and reorder Slider item, choose Site image, unsafe Button | Layout validation fails safely; slider media remains bound |

## Results

| Verification | Result |
| --- | --- |
| Inspector + model + composition regression | 12 passed ([inspector.xml](inspector.xml)) |

Advanced portal browser E2E remains waived consistent with prior builder packs;
component coverage exercises media-picker integration and unsafe-input mapping
against the shared layout contract.
