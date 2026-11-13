# Shared preview/public visual renderer — 2026-11-12

Admin private preview and public Pages share `PublicPageView` / `VisualLayoutView`.
Allowlisted widget types, surface-specific media delivery, safe text/links/style
tokens, legacy retention and controlled unavailable fallbacks keep visual
behavior consistent. Slider, Tabs and Accordion behave equivalently on both
surfaces for the same layout fixture.

## Contracts and implementation

- Runtime boundary: [visual-layout-contract.md](../../architecture/visual-layout-contract.md)
- Shared UI: [public-page.tsx](../../../frontend/packages/ui/src/public-page.tsx),
  [visual-layout.tsx](../../../frontend/packages/ui/src/visual-layout.tsx)
- Fixtures: [fixtures.json](../../../frontend/packages/types/src/layout/fixtures.json)
- Coverage: [ui.xml](ui.xml)

## Evidence attachments

| Artifact | Role |
| --- | --- |
| [fixture-results.json](fixture-results.json) | 43-catalog parity, interactive widgets, legacy/unsupported evidence |
| [ui.xml](ui.xml) | Vitest JUnit for `@uog/ui` renderer suites |

## Acceptance mapping

| Criterion | Status | Evidence |
| --- | --- | --- |
| Approved layouts produce equivalent structure in preview and public | **PASS** | Structure signatures equal for all 43 catalog fixtures |
| Unknown/unsupported nodes fail safely without breaking the Page | **PASS** | Integration fallback + sibling button/headline remain |
| Slider, Tabs and Accordion behave equivalently on both surfaces | **PASS** | Interactive exercise on public and privateMediaBase preview |

## Results

| Verification | Result |
| --- | --- |
| Shared UI renderer + public page safety | 72 passed ([ui.xml](ui.xml)) |

Dynamic source bindings remain the documented integration fallback per the
layout contract; this story covers shared static/primitive rendering and
interactive disclosure/slider parity, not every production data service.
