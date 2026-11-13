# Public layout accessibility and rendering security — 2026-11-12

Public Visitors consume published visual layouts through the shared
`PublicPageView` / `VisualLayoutView` renderer. This pack verifies responsive
reflow, keyboard operation and hostile-payload handling on both public and
private-preview surfaces against **WCAG 2.2 AA** (project review assumption;
no separate WCAG version was declared elsewhere).

Dependencies: P3-PUBLIC-001, P3-PUBLIC-002, P3-FE-BUILDER-003.

## Contracts and implementation

- Layout contract: [visual-layout-contract.md](../../architecture/visual-layout-contract.md)
- Shared renderer: [visual-layout.tsx](../../../frontend/packages/ui/src/visual-layout.tsx),
  [public-page.tsx](../../../frontend/packages/ui/src/public-page.tsx)
- Safe links: [site-navigation.tsx](../../../frontend/packages/ui/src/site-navigation.tsx) `safeMenuHref`
- Controlled harness: [public-layout-a11y](../../../frontend/scripts/qa/public-layout-a11y/)

## Target and viewport matrix

| Item | Value |
| --- | --- |
| Accessibility target | WCAG 2.2 AA (review assumption) |
| Widths exercised | **320** (reflow), 390, 768, 1280, 1440 |
| Surfaces | public delivery and admin private preview (`privateMediaBase`) |
| Fixture | Three-column layout with slider, tabs, accordion, long text, image alts and a safe link |

Automated viewport, axe, keyboard and hostile-scenario rows:
[browser-results.json](browser-results.json).

Screenshots (public and preview at each width):
`public-320.png` … `public-1440.png`, `preview-320.png` … `preview-1440.png`.

## Manual keyboard notes

| Control | Expected | Result |
| --- | --- | --- |
| Image slider Previous/Next | Reachable buttons (≥44px), live region announces “N of M” | Pass |
| Tabs | One Tab stop on the selected tab (`tabIndex` 0); inactive tabs `tabIndex` -1; **ArrowLeft/ArrowRight** move and activate with wrap; Home/End jump ends; panels focusable | Pass (blocker fixed: arrow-key navigation + ref-based focus) |
| Tab panels | Entered after the tablist; long/hostile text wraps without horizontal page growth | Pass |
| Accordion `<details>`/`<summary>` | Native Enter/Space; visible focus ring; ≥44px summary hit target; long titles wrap | Pass |
| Safe link / button | Keyboard reachable; unsafe `javascript:` URLs render as plain text | Pass |
| Focus visibility | 3px primary outline on interactive widgets and panels | Pass at 320–1440 |

## Negative security / hostile props

| Scenario | Input | Expected | Result |
| --- | --- | --- | --- |
| script-url | Button `href="javascript:alert(1)"` | No navigable unsafe link; no script execution | Pass — fails closed / plain text |
| style-token | Unapproved `tone` style token | Layout validation rejects; unavailable status; no CSS injection | Pass |
| unknown-version | `schema_version: 99` | Fail closed without active content | Pass |
| foreign-media | Invalid asset reference | No foreign URL fetch; alt fallback only when allowed | Pass |
| Markup in labels/captions/tab text | `<img onerror=…>`, `<script>` in editor HTML | Escaped as text / tags stripped; `__injected` never set | Pass (React text + `stripTags` / `safeMenuHref`) |

## Accessibility and rendering-security matrix

| Check | 320 | 390 | 768 | 1280 | 1440 | Preview parity |
| --- | --- | --- | --- | --- | --- | --- |
| Columns stack to single track below container threshold | Pass | Pass | Pass | 3-col | 3-col | Same |
| Headings H1 then H2 structure | Pass | Pass | Pass | Pass | Pass | Same |
| Image alternatives present | Pass | Pass | Pass | Pass | Pass | Same |
| Focus indicator 3px | Pass | Pass | Pass | Pass | Pass | Same |
| Keyboard: slider / tabs / accordion / link | Pass | Pass | Pass | Pass | Pass | Same |
| axe violations | 0 | 0 | 0 | 0 | 0 | Same |
| axe incomplete (manual) | color-contrast | color-contrast | color-contrast | color-contrast | color-contrast | Same |
| Hostile script URL / style token / bad version / foreign media | Pass (fail closed) | — | — | — | — | Pass |

## Acceptance mapping

| Criterion | Status | Evidence |
| --- | --- | --- |
| Core fixtures readable at agreed widths; keyboard and a11y checks | **PASS** | [browser-results.json](browser-results.json), screenshots, keyboard notes above |
| Hostile payloads cannot execute scripts or produce unsafe links/CSS in preview or public | **PASS** | Hostile scenarios in browser-results; unit coverage in `@uog/ui` |
| Widget controls operable by keyboard at narrow widths; untrusted labels/media/URLs cannot inject active content | **PASS** | 320px rows + Tabs arrow-key fix + escaping/allowlists |

## Results

| Verification | Result |
| --- | --- |
| Controlled browser viewport + axe + keyboard matrix | See [browser-results.json](browser-results.json) |
| Shared UI Tabs/Slider/Accordion + public safety suites | Exercised via `@uog/ui` vitest (`visual-layout`, `public-page`) |

Color-contrast remains axe **incomplete** for manual review against brand tokens; it is not treated as an automated failure in this pack.
