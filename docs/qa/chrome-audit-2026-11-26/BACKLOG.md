# P4-F-CHROME prioritised backlog — 26 November 2026

Parent: **P4-F-CHROME**. Proposed IDs are planning labels, not Azure work-item IDs, until the PO creates or links them. Severity and evidence: [README.md](README.md). No product code was changed by the audit.

## Priority order (PO review draft)

| Priority | Story | Scope | Findings | Size |
|---|---|---|---|---|
| **P0** | P4-F-CHROME-03 (existing) | Header brand clipping at desktop widths | H-02 | S |
| **P0** | P4-F-CHROME-08 (new) | Metadata, robots/sitemap and 404 semantics | H-03, H-04, H-05, M-01 | M |
| **P0** | P4-F-CHROME-10 (new) | Admin H1s, accessible names, drawer/builder contrast | H-06, M-04, M-05, M-07 | M |
| **P1** | P4-F-CHROME-09 (new) | Public focus management and empty/disabled states | M-02, M-03, L-02 | S/M |
| **P1** | P4-F-CHROME-11 (new) | Public performance: image dimensions + production Lighthouse | M-06, G-04 | M |
| **P1** | P4-F-CHROME-01 (existing) | Empty-home fallback heading | M-01 | S |
| **P1** | P4-F-CHROME-07 (new) | Layout compatibility regression guard | H-01 (not reproduced; keep) | M |
| **P1** | P4-F-CHROME-12 (new) | AT, i18n, high-contrast, cross-browser fixtures | M-08, G-01…G-05 | S |
| **P2** | P4-F-CHROME-05 (existing) | Contact copy / publish gate | G-06 | S |
| **P2** | P4-F-CHROME-06 (existing) | Target-size + mobile overflow polish | L-01, H-02 (mobile) | S |

P0 = next increment. No Critical finding. H-01 remains as a **regression** story because the 24 Nov failure mode was severe even though it is not open on this baseline.

## Changes to existing stories

- **P4-F-CHROME-03:** AC that brand never truncates at 1280 / 1440 / 1920, including long or localised names; cite `brand-measure.json` (184 vs 159).
- **P4-F-CHROME-06:** Add category overflow at 320/360 and desktop brand clip evidence.
- **P4-F-CHROME-01:** Empty-home must expose one H1 and a non-generic description; cite `home-empty-1440.png`.
- **P4-F-CHROME-05:** Retain contact publish-copy checks from the 24 Nov pack.

## Proposed stories (summary)

### P4-F-CHROME-07 — Layout compatibility regression guard

**Priority:** P1 · **Source:** H-01 (historical)

Keep renderer/builder shared validation, recoverable error state with H1, and fixtures for each supported layout version. 26 Nov: Main homepage content renders; sampled builder page opens (locked). Still required before closing chrome risk.

### P4-F-CHROME-08 — Metadata, crawl files and real 404

**Priority:** P0 · **Source:** H-03, H-04, H-05, M-01

Per-template title/description/canonical/OG; HTTP 404 with H1; real `text/plain` robots and XML sitemap; decide JSON-LD and hreflang policy; empty-home H1.

### P4-F-CHROME-09 — Public focus and empty/disabled behaviour

**Priority:** P1 · **Source:** M-02, M-03, L-02

Focus search input on open; focus close control on header disclosure; keep Escape/restore; tighten POSTS-disabled empty UI; app-level offline shell still outstanding from 24 Nov states pack.

### P4-F-CHROME-10 — Admin shell semantics

**Priority:** P0 · **Source:** H-06, M-04, M-05, M-07

Fix workspace card accessible names (visible text ⊆ name); add H1 on Menus and Pages; name progressbars; builder chip contrast; drawer initial focus + role.

### P4-F-CHROME-11 — Performance baseline

**Priority:** P1 · **Source:** M-06, G-04

Width/height on content images; font-display policy; production Lighthouse CLS/LCP on home, posts, post detail; builder interaction latency budget.

### P4-F-CHROME-12 — Verification fixtures

**Priority:** P1 · **Source:** M-08, G-01…G-05

Seed multilingual + high-contrast Sites; screen-reader protocol; Chrome/Firefox/Safari + tablet matrix; attach results to the chrome epic.

## PO decision log

| Date | Decision | Owner |
|---|---|---|
| _pending_ | Confirm P0 order and story creation/linking in Azure DevOps | Product Owner |
| _pending_ | Confirm H-01 remains regression-only vs reopen as defect | Product Owner |
| _pending_ | Provide Azure Issue ID for evidence attachment (AC-05) | Product Owner |
