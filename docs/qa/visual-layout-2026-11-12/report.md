# Versioned visual-layout contract verification

Verified on 2026-11-12. The widget list comes from the product-provided 43-widget
catalog in this session. The [contract and compatibility matrix](../../architecture/visual-layout-contract.md)
describe the selected version policy, column ratios, safe tokens, limits and
runtime boundary. No separate human frontend design sign-off is claimed.

## Published artifacts

- [Registry JSON schema](../../../backend/apps/cms/schemas/layout/layout-v1.schema.json)
- [Shared fixtures and 43 widget examples](../../../backend/apps/cms/schemas/layout/fixtures.json)
- [Generated typed properties](../../../frontend/packages/types/src/layout/generated.ts)
- [Sample three-column layout](sample-layout.json)
- [Compatibility adapter](../../../frontend/packages/types/src/layout/legacy.ts)
- [Frozen database migration](../../../backend/apps/cms/migrations/0014_visual_layout_contract.py)

The new envelope is `metadata.visual_layout` with `schema_version: 1`. Existing
`blocks`/`blocks_version`, the template hint and legacy rendering stay intact.
Arrays preserve order. Rows have one to three ordered columns with allowlisted
ratios, including 60/40. Sections cannot nest. IDs, repeaters, total nodes,
payload bytes, properties and style/link tokens are bounded and validated.

## Evidence

| Check | Result |
| --- | --- |
| [Backend contract, legacy blocks, API, media inventory and removal regressions](backend.xml) | 138 passed, 2 existing optional integration cases skipped |
| [Shared validator/renderer and legacy Page renderer](ui.xml) | 68 passed; includes examples for all 43 widget types |
| [Admin Page authoring/preview and media picker save](admin.xml) | 22 passed |
| Workspace TypeScript checks | All five tasks passed |
| Generated schema/types/fixtures and frozen-schema drift check | Passed; also wired into Azure CI |
| Migration drift and Django system checks | No changes detected; no issues |

Backend coverage includes valid and invalid common fixtures, unknown widget,
unsupported version, duplicate IDs, nested Sections, excessive items, invalid
ratios and unsafe style/link fields. Domain errors carry field paths. The raw
database test supplies revision context before checking duplicate IDs, so it
exercises the new layout guard rather than only the existing revision guard.

Migration rehearsal reverses to pre-visual `cms.0013`, creates a legacy Page,
reapplies the current migration graph and verifies blocks, version, metadata
and revision number are unchanged. A fresh test database also applied the new
migration successfully. The local development database has applied `cms.0014`.

The same three-column Image Slider fixture is validated/rendered by the shared
UI package and previewed through the real Admin Page component. The portal's
existing `PublicPageView` uses that same component. Unknown visual versions
produce a controlled unavailable state; Pages without a visual payload use the
existing legacy renderer. The explicit legacy adapter also covers a full
100-block document without losing source order or IDs.

Visual media tests reuse one Site-owned image in both a Slider and an Image,
check distinct node/field/item inventory entries, retain publication references
after draft removal and permit deletion only after publishing the removal.
Foreign-Site assets are rejected before a Page is created. Existing removal
and race tests run alongside this new inventory integration.

## Scope of runtime support

All 43 widget configurations are typed and validated. This contract increment
does not implement every dynamic widget's production runtime. The compatibility
matrix documents static/primitive rendering and controlled fallback behavior;
dynamic services, full carousel/masonry behavior, animations, form submission
and other runtime bindings remain separate implementation work.
