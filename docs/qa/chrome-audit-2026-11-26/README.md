# P4-F-CHROME remaining-surfaces audit

**Audit date:** 26 November 2026  
**Repository baseline:** `546ef6d`  
**Review environment:** seeded local Docker Compose; PostgreSQL **SHARE** lock during public collection  
**Product code modified:** **No**  
**Prior pack:** [docs/qa/chrome-audit-2026-11-24/](../chrome-audit-2026-11-24/)

## Verdict

Evidence-backed backlog is ready for the next increment. **Do not claim WCAG 2.2 AA complete.** Public templates have **zero axe A/AA violations** in the tested states, but **five High** findings remain (brand clipping, soft-404, crawl files, metadata gaps, admin accessible-name mismatch). The Nov-24 Main homepage / builder layout failure (**H-01**) is **not reproduced** on this baseline: `www.uog.local/` renders page body content, and the sampled builder page opens (locked for review).

**AC-05** (Azure DevOps attachment) and **AC-06** (PO prioritisation sign-off) are open until the Product Owner provides the Issue ID and reviews [BACKLOG.md](BACKLOG.md).

## Acceptance criteria

| AC | Status | Evidence |
|---|---|---|
| AC-01 severity + evidence + repro per surface | **Met** | This README §Findings, screenshots, JSON |
| AC-02 findings mapped to P4-F-CHROME stories | **Met** | [BACKLOG.md](BACKLOG.md) |
| AC-03 reproducible read-only review env | **Met** | [isolation.json](isolation.json), [reproduce.md](reproduce.md) |
| AC-04 no product code changes | **Met** | Evidence + harness scripts only |
| AC-05 evidence attached to Azure Issue | **Blocked** | No Issue ID / ADO API in this session — [ado-status.md](ado-status.md) |
| AC-06 backlog reviewed with PO | **Pending** | [po-review.md](po-review.md) |

## What was audited

### Public templates (axe at 1440 & 390; screenshots)

| Surface | Host/path | Result | Evidence |
|---|---|---|---|
| Main homepage | `www.uog.local/` | Pass axe; **brand clipped**; body content present | `home-main-*.png`, `brand-measure.json` |
| Child homepage | `coi.uog.local/` | Pass axe | `home-child-*.png` |
| Page | `/mainqa-8995d437-information` | Pass axe; metadata mostly present | `page-*.png`, `metadata.json` |
| Post list | `aau-review.localhost/posts` | Pass axe; **no description/canonical/OG** | `posts-*.png` |
| Post detail | `/posts/aau-reference-dd1aa7a8` | Pass axe; metadata present; images lack dimensions | `post-detail-*.png`, `performance.json` |
| Category | `/posts/categories/research-655af51c8f` | Pass axe; metadata gap; slight overflow 320/360 | `category-*.png`, `responsive.json` |
| Empty category | `.../empty-655af51c8f` | Pass axe; empty state visible | `category-empty-*.png` |
| Search | Header dialog, query `QA` | Pass structure; **initial focus not on input** | `search-results-*.png`, `keyboard.json` |
| 404 | `/does-not-exist-audit` | **Fail:** HTTP 200, no H1, breadcrumb of missing path | `404-*.png`, `http-checks.json`, `404-dom.json` |
| Sidebars | `layout-…/left-sidebar`, `/right-sidebar` | Pass axe | `sidebar-*-*.png` |
| Empty homepage | `cmhs.uog.local/` | **Fail:** no H1, no description | `home-empty-*.png` |
| POSTS disabled | `news-disabled-…/posts` | Pass axe; module message visible | `posts-disabled-*.png` |

Responsive matrix: **320, 360, 390, 768, 1024, 1280, 1440, 1920** on six templates (`responsive.json`, 48 runs).

### Admin (Main Site id **17**)

| Surface | Result | Evidence |
|---|---|---|
| Platform workspace | **Serious** `label-content-name-mismatch` on Organizations/Sites/Modules cards | `admin-workspace-1440.png`, `admin.json` |
| Site dashboard | Pass axe; H1 Dashboard | `admin-site-dashboard-1440.png`, `admin-site17.json` |
| Appearance / Header / Footer | Pass axe when settled; H1 present | `admin-appearance-1440.png`, `admin-header-1440.png`, `admin-footer-1440.png` |
| Menus | Pass axe; **no H1** (visible “Navigation” is not H1) | `admin-menus-1440.png` |
| Pages | Pass axe; **no H1** | `admin-pages-1440.png` |
| Visual Builder (Site 102 sample) | Opens; locked-for-review; **color-contrast** on chip | `admin-builder-aau-1440.png` / `admin-builder-home-1440.png` |
| Admin mobile drawer | Escape restores to “Open navigation menu”; initial focus not on close | `admin-mobile-keyboard.json`, `admin-mobile-nav-open.png` |

### Method

- **a11y:** axe-core 4.14.0, WCAG 2.0/2.1/2.2 A/AA; keyboard for search + public header disclosure + admin drawer.
- **Perf:** PerformanceObserver FCP/CLS/images — **not** Lighthouse.
- **SEO/HTTP:** Host-header probes for `robots.txt`, `sitemap.xml`, favicon, unknown path.
- **i18n:** DB language counts + public DOM (`i18n-db.json`, `metadata.json`).
- **Isolation:** SHARE lock + blocked write (`isolation.json`).

## Findings

Severity: **High** = blocks core journey / material a11y or SEO; **Medium** = significant degradation or required verification gap; **Low** = polish.

### H-02 — Desktop header brand clipped at 1280–1920 px

**Severity:** High · **Story:** P4-F-CHROME-03 / -06  
**Evidence:** `brand-measure.json`, `brand-1440.png`, `home-main-1440.png`

Brand text “University of Gondar” measures `scrollWidth 184` / `clientWidth 159` at 1280, 1440 and 1920 px (visually “University of G…”).

**Repro:** Open `http://www.uog.local/` at 1440 px; inspect header site title overflow.

### H-03 — Unknown routes return HTTP 200 soft-404

**Severity:** High · **Story:** P4-F-CHROME-08  
**Evidence:** `http-checks.json`, `404-1440.png`, `404-dom.json`, `metadata.json`

`/does-not-exist-audit` returns **200** `text/html`, title “University of Gondar — Public Portal” or Site name, **no H1**, body “This Site has no published page to show.”, breadcrumb includes “Does Not Exist Audit”.

**Repro:** `curl.exe -sI -H "Host: aau-review.localhost" http://127.0.0.1/does-not-exist-audit`

### H-04 — `robots.txt` and `sitemap.xml` served as HTML app shell

**Severity:** High · **Story:** P4-F-CHROME-08  
**Evidence:** `http-checks.json`

Both paths return **200** with `content-type: text/html` and an HTML document body.

**Repro:** `curl.exe -sD - -H "Host: www.uog.local" http://127.0.0.1/robots.txt | more`

### H-05 — Incomplete metadata on list, archive, empty and 404 templates

**Severity:** High · **Story:** P4-F-CHROME-08  
**Evidence:** `metadata.json`

| Template | Title quality | Description | Canonical | OG | H1 |
|---|---|---|---|---|---|
| Post list | Generic portal | Missing | Missing | Missing | News |
| Category | Generic portal | Missing | Missing | Missing | Present |
| Empty home | Generic portal | Missing | Missing | Missing | **None** |
| 404 | Site/generic | Partial | Missing | Missing | **None** |
| Page / post detail | OK | Present | Present | Present | Present |

No JSON-LD and no hreflang on any audited template. Favicon responds as `image/x-icon`.

### H-06 — Admin workspace accessible-name mismatch (serious)

**Severity:** High · **Story:** P4-F-CHROME-10  
**Evidence:** `admin.json`, `admin-workspace-1440.png`

axe `label-content-name-mismatch` on `a[aria-label="Open the Organizations|Sites|Modules section"]` — visible card text is not included in the accessible name.

**Repro:** Sign in to `http://localhost/admin/`; run axe on the platform Dashboard cards.

### M-01 — Empty homepage fallback has no H1

**Severity:** Medium · **Story:** P4-F-CHROME-01 / -08  
**Evidence:** `home-empty-1440.png`, `metadata.json`

`cmhs.uog.local/` shows only “This Site has no published page to show.” with no heading.

### M-02 — Search dialog does not focus the query field on open

**Severity:** Medium · **Story:** P4-F-CHROME-09  
**Evidence:** `keyboard.json`

Initial focus lands on the dialog presentation container (`role=presentation`), not the “Search published Pages and news” textbox. Escape restores focus to “Search this Site”. Tab stays inside the dialog.

### M-03 — Public mobile header disclosure focus

**Severity:** Medium · **Story:** P4-F-CHROME-09  
**Evidence:** `keyboard.json`, `drawer-open-390.png`

Control is **“Open site header”** (not a named navigation drawer). On open, focus is not on “Close site header”. Escape closes and restores to the open control; Tab samples stayed inside the header region.

### M-04 — Admin Menus and Pages screens lack H1

**Severity:** Medium · **Story:** P4-F-CHROME-10  
**Evidence:** `admin-site17.json`, `admin-menus-1440.png`, `admin-pages-1440.png`

Menus shows visible “Navigation” copy without an `h1`. Pages likewise has no `h1` after settle.

### M-05 — Admin mobile drawer semantics / initial focus

**Severity:** Medium · **Story:** P4-F-CHROME-10  
**Evidence:** `admin-mobile-keyboard.json`

Drawer opens; Escape restores to “Open navigation menu”. Initial focus is not on a close control; nav uses `aria-label="Admin sections"` without an explicit dialog role on the measured node.

### M-06 — Content images omit width/height (CLS risk)

**Severity:** Medium · **Story:** P4-F-CHROME-11  
**Evidence:** `performance.json`

Post list/detail thumbnails use `loading=lazy` but no `width`/`height` attributes. Lab CLS was **0.000** in this run (vs 0.3+ on 24 Nov) — unstable; production Lighthouse still required.

### M-07 — Builder chrome contrast failure

**Severity:** Medium · **Story:** P4-F-CHROME-10  
**Evidence:** `admin-warm.json`, builder screenshot

axe `color-contrast` on `.MuiChip-label` (ratio ~1.02) in the Visual Builder chrome for the locked AAU comparison page.

### M-08 — i18n and theme verification gaps

**Severity:** Medium · **Story:** P4-F-CHROME-12  
**Evidence:** `i18n-db.json`, `verification-gaps.json`

Only `en` / `en-us`; no public language switcher; no high-contrast public fixture.

### L-01 — Category archive slight horizontal overflow at 320/360

**Severity:** Low · **Story:** P4-F-CHROME-06  
**Evidence:** `responsive.json`

`documentWidth` 344 vs 320 and 363 vs 360 on the long Site brand string.

### L-02 — POSTS-disabled route still shows filter chrome

**Severity:** Low · **Story:** P4-F-CHROME-09  
**Evidence:** `posts-disabled-1440.png`

Message “News is not available for this Site.” is clear; Category/Tag filters remain visible.

### Delta vs 24 November 2026

| Finding | 24 Nov | 26 Nov |
|---|---|---|
| H-01 layout unavailable / builder blocked | High | **Not reproduced** on Main public home or sampled builder page — keep regression story P4-F-CHROME-07 |
| H-02 brand clip | High | **Confirmed** |
| H-03–H-05 SEO/404/metadata | High | **Confirmed** |
| H-06 admin name mismatch | High | **Confirmed** |
| CLS on posts | 0.3+ | Lab 0.0 this run — still open pending production Lighthouse |

## Verification gaps

See [verification-gaps.json](verification-gaps.json): screen reader, high contrast, i18n fixtures, cross-browser, production Lighthouse.

## Artefacts

- JSON: `public-accessibility.json`, `metadata.json`, `responsive.json`, `performance.json`, `keyboard.json`, `http-checks.json`, `isolation.json`, `admin.json`, `admin-site17.json`, `admin-warm.json`, `brand-measure.json`, `i18n-db.json`
- Screenshots: `*-1440.png`, `*-390.png`, selected `*-320.png` / `*-768.png`, admin `admin-*-1440.png`
- Backlog: [BACKLOG.md](BACKLOG.md)
- Reproduce: [reproduce.md](reproduce.md)
