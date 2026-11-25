# P4-F-CHROME prioritised backlog — 24 November 2026

Parent: **P4-F-CHROME**. Proposed IDs are not Azure DevOps work-item IDs. Severity and evidence come from [README.md](README.md); no product code was changed by the audit.

## Priority order

| Priority | Story | Scope | Findings | Size |
|---|---|---|---|---|
| **P0** | P4-F-CHROME-07 (new) | Layout compatibility and builder recovery | H-01 | L |
| **P0** | P4-F-CHROME-03 (existing) | Header brand clipping regression at desktop widths | H-02 | S |
| **P0** | P4-F-CHROME-08 (new) | Metadata, robots/sitemap and 404 semantics | H-03, H-04, H-05, M-01 | M |
| **P0** | P4-F-CHROME-10 (new) | Admin H1s, accessible names and mobile drawer semantics | H-06, M-04, M-05, L-06 | M |
| **P1** | P4-F-CHROME-09 (new) | Public focus management, error and empty states | M-02, M-03, L-02, L-03 | S/M |
| **P1** | P4-F-CHROME-11 (new) | Public performance and typography delivery | M-06, M-07, L-01 | M |
| **P1** | P4-F-CHROME-01 (existing) | Empty-home fallback heading | M-01 | S |
| **P1** | P4-F-CHROME-12 (new) | Verification fixtures and assistive-technology evidence | M-08, M-09, all verification gaps | S |
| **P2** | P4-F-CHROME-05 (existing) | Contact copy and QA placeholder publish gate | L-04, L-05 | S |
| **P2** | P4-F-CHROME-06 (existing) | House 44 px target-size follow-up | L-06 | S |

P0 means "next increment"; it is not a production incident classification. No Critical finding was recorded. H-06 is P0 because it is an axe **serious** WCAG 2.5.3 failure in the admin entry point.

**Changes to existing stories**

- **P4-F-CHROME-03:** add an acceptance criterion that the brand never truncates at 1280, 1440 or 1920 px, including long/localised Site names.
- **P4-F-CHROME-06:** add the observed public target-size rows (17–23 px inline links, 37–40 px controls) and the mobile brand-clipping cases at 320/360/390 px to its test evidence.
- **P4-F-CHROME-05:** add contact-form publication copy and the seeded QA/placeholder content to the pre-publish lint evidence.

## Proposed stories

### P4-F-CHROME-07 — Restore compatible layouts and a recoverable Visual Builder

**Priority:** P0 · **Source:** H-01

**User story:** As a Site Author, I want every saved Page layout to open in the Visual Builder or render publicly, so that a schema change cannot silently remove content or strand me in an error screen.

**Implementation requirements**

- Inventory all saved `visual_layout` documents by version, block type and validation result; classify affected Sites and published/draft status.
- Make the public renderer and the builder use the same compatibility/validation contract.
- For unsupported legacy layouts, render the last valid block content where it is safe, and provide a migration or explicit recovery path.
- The Builder error state must identify the Page, the reason and the recovery action; it must not be a dead end with "Retry".
- Add a compatibility test fixture for each supported schema version and a regression test that a supported page opens in both renderer and builder.
- Do not mutate or discard saved authoring data during migration.

**Acceptance criteria**

- AC-01: Every seeded draft and published Page opens in the Builder or shows a documented, recoverable compatibility state.
- AC-02: A supported layout renders its body on the public page; no valid Page shows "This page content is currently unavailable."
- AC-03: The Main Site homepage renders its intended content in the review environment.
- AC-04: The error state includes the Page name, validation reason and a recovery link, with an H1.
- AC-05: Migration is dry-runnable, reports affected Pages and preserves content.
- AC-06: Renderer and Builder compatibility tests cover every supported layout version.

**Evidence:** `home-main-1440.png`, `admin-builder-1440.png`, `admin.json`.

---

### P4-F-CHROME-08 — Complete page metadata and real crawl/404 responses

**Priority:** P0 · **Source:** H-03, H-04, H-05, M-01

**User story:** As a search engine or visitor, I want each public template to identify itself correctly and missing routes to return a real 404, so that search results, social cards and assistive technology reflect the actual page.

**Implementation requirements**

- Per-template metadata: Site/page title, description, canonical and Open Graph for home, post list, post detail, category archive, Page, search and empty states.
- Return HTTP 404 for unknown routes and render a visible H1, meaningful title and recovery links; do not return the Site's normal page shell with 200.
- Serve a valid `robots.txt` with an explicit policy and a valid XML `sitemap.xml` scoped to the requesting Site/host; return 404 or the correct content type, never an HTML document.
- Define whether structured data (Organization/WebSite/NewsArticle/BreadcrumbList) is in scope; if yes, emit validated JSON-LD for the supported templates.
- Define `hreflang` policy when multilingual Sites exist; do not emit empty or self-only hreflang without a decision.
- Empty-home fallback: one H1, a description and a non-indexable decision for the empty state.
- Add tests for status codes, content types, canonical host and metadata across templates.

**Acceptance criteria**

- AC-01: Unknown public routes return 404 with a visible H1 and no breadcrumb containing the missing path as if it were valid.
- AC-02: `robots.txt` is `text/plain` and `sitemap.xml` is XML, both 200; neither is the HTML app shell.
- AC-03: Home, post list and category have non-generic titles, descriptions and canonical URLs; social cards use the same URL.
- AC-04: Post detail and Page retain their current correct metadata.
- AC-05: The empty-home fallback has one H1 and a description.
- AC-06: Metadata/status tests run against the Main Site and at least two child Sites.

**Evidence:** `404-1440.png`, `http-checks.json`, `metadata.json`, `home-empty-1440.png`.

---

### P4-F-CHROME-09 — Fix public focus, error and empty-state behaviour

**Priority:** P1 · **Source:** M-02, M-03, L-02, L-03

**User story:** As a keyboard or assistive-technology user, I want the search, drawer and failure states to put focus in the right place and explain what happened, so that public navigation is predictable.

**Implementation requirements**

- Search dialog: focus the search input on open (after the dialog's focus trap settles); keep Escape/restore behaviour.
- Public drawer: focus the close button on open; keep the focus trap, Escape and trigger restoration.
- Add an app-level offline/API-failure shell with an accessible status, retry and a safe return path; do not rely on the browser interstitial.
- Treat optional module 404s as expected absence, not console errors, or suppress the console noise while keeping the fallback.
- Add keyboard tests that assert the initial active element, trap, Escape and restoration for both overlays.

**Acceptance criteria**

- AC-01: Opening search places focus in the search field; typing works immediately.
- AC-02: Opening the mobile drawer places focus on "Close navigation menu".
- AC-03: Both overlays trap focus, close on Escape and return focus to their trigger.
- AC-04: An offline/API failure shows an app-rendered status with retry, not only the Edge error page.
- AC-05: Disabled optional modules do not produce failed-request console noise that obscures real errors.
- AC-06: Tests run at 390 and 1440 px.

**Evidence:** `keyboard.json`, `search-results.json`, `states.json`, `console-issues.json`.

---

### P4-F-CHROME-10 — Make the admin shell semantically navigable

**Priority:** P0 · **Source:** H-06, M-04, M-05, L-06

**User story:** As an admin using a screen reader or voice control, I want every admin screen to have a heading, unique title, correctly named controls and a labelled navigation drawer, so that I can orient myself and operate the console.

**Implementation requirements**

- Give Menus, Pages, Posts, Media and the Builder a single H1 matching the screen; give the Builder error state an H1.
- Make each admin document title unique: page name + Site + console.
- Fix workspace card accessible names so the visible title and description are included, or remove the redundant `aria-label` and use `aria-labelledby`.
- Fix footer column reorder names so the visible direction/column text is part of the accessible name.
- Give the mobile drawer `role="dialog"`/modal semantics and an accessible name ("Site navigation"), or expose a labelled `<nav>` with a clear close control; shorten link names so descriptions are not concatenated into the name.
- Bring reorder/Retry controls to the house 44 px target where they are standalone controls.
- Add axe and keyboard tests for workspace, Menus, Pages, Posts, Media, Builder and the mobile drawer.

**Acceptance criteria**

- AC-01: Every audited admin screen has exactly one H1.
- AC-02: Every admin screen has a unique, descriptive document title.
- AC-03: Zero `label-content-name-mismatch` results on workspace and Menus.
- AC-04: The mobile drawer is announced as navigation, traps focus, closes on Escape and restores focus.
- AC-05: Admin link/button accessible names match their visible labels.
- AC-06: Tests run at 1440 and 390 px with a signed-in read-only account.

**Evidence:** `admin.json`, `admin-mobile.json`, `admin-mobile-keyboard.json`, `admin-*-1440.png`.

---

### P4-F-CHROME-11 — Meet a public performance budget and deliver the approved typeface

**Priority:** P1 · **Source:** M-06, M-07, L-01

**User story:** As a public visitor, I want pages to stay visually stable and use the approved typography, so that reading is comfortable and content does not jump while it loads.

**Implementation requirements**

- Measure a production build with the deployment cache/CDN and real throttling before changing code; record LCP, CLS, FCP and long tasks.
- If CLS ≥ 0.1 reproduces, remove the footer/DIV shift sources: reserve layout, avoid late style/font swaps and stabilise the footer composition.
- Deliver Inter/Source Sans 3 through a self-hosted or approved `@font-face`/`next/font` path with `font-display`, preload for the primary face, and a measured fallback metric adjustment; do not leave a CSS stack referencing unavailable faces.
- Add intrinsic `width`/`height` or aspect-ratio to content and logo images; keep hero images eager and below-fold cards lazy.
- Set an explicit performance budget and a regression check for posts/post detail.
- Re-measure admin route readiness on a production build; if 4.8–7.5 s persists, profile backend and client waterfalls.

**Acceptance criteria**

- AC-01: Production-build CLS ≤ 0.1 on post list and post detail at 1440 and 390 px.
- AC-02: LCP ≤ 2.5 s under the agreed test profile.
- AC-03: The approved typeface is actually loaded, or the design owner approves a fallback-only stack.
- AC-04: Content images expose intrinsic dimensions and appropriate loading priority.
- AC-05: A repeatable performance report is attached to the Story.
- AC-06: Admin route readiness is measured and either passes the agreed budget or has a tracked follow-up.

**Evidence:** `performance.json`, `perf-detail.json`, `admin-warm.json`.

---

### P4-F-CHROME-12 — Provide the missing verification fixtures and assistive-technology evidence

**Priority:** P1 · **Source:** M-08, M-09 and audit gaps

**User story:** As a Product Owner, I want the audit claims backed by real screen-reader, high-contrast, multilingual, production-performance and cross-browser evidence, so that WCAG 2.2 AA sign-off is defensible.

**Implementation requirements**

- Seed one active high-contrast Site and repeat the public template matrix (home, Page, posts, post detail, category, search, 404, contact, sidebar) plus the drawer/dialog and error states.
- Seed one two-language Site, implement or explicitly descope locale-prefixed routes, and verify menu/page fallback rules and the public switcher.
- Run NVDA or Narrator on Windows across the public header, drawer, search, footer disclosure, Page and admin workspace/menus; record verbatim announcements and focus order.
- Measure a production build on the agreed browser/device matrix, including at least Firefox and Safari/WebKit and one real iOS/Android device.
- Run the Builder interaction latency test once H-01 makes a canvas reachable.
- Record the scope decision for structured data and `hreflang`.

**Acceptance criteria**

- AC-01: High-contrast public template evidence exists for both desktop and mobile.
- AC-02: Multilingual switching and fallback are either demonstrated or formally descoped.
- AC-03: A screen-reader session is attached with findings and retest results.
- AC-04: Production performance is measured under a documented profile.
- AC-05: Cross-browser/device results are recorded; unsupported browsers are stated.
- AC-06: Builder interaction latency is measured or explicitly blocked with the reason.

**Evidence:** `environment.json`, current audit limitations in [README.md](README.md).

## Mapping of every finding

| Finding | Severity | Story |
|---|---|---|
| H-01 Layout incompatibility / content unavailable | High | P4-F-CHROME-07 |
| H-02 Desktop brand clipping | High | P4-F-CHROME-03, P4-F-CHROME-06 |
| H-03 Soft 404 | High | P4-F-CHROME-08 |
| H-04 robots/sitemap HTML | High | P4-F-CHROME-08 |
| H-05 Incomplete metadata | High | P4-F-CHROME-08 |
| H-06 Admin accessible-name mismatch | High | P4-F-CHROME-10 |
| M-01 Empty-home no H1 | Medium | P4-F-CHROME-01, P4-F-CHROME-08 |
| M-02 Search initial focus | Medium | P4-F-CHROME-09 |
| M-03 Public drawer initial focus | Medium | P4-F-CHROME-09 |
| M-04 Admin missing H1/generic titles | Medium | P4-F-CHROME-10 |
| M-05 Admin drawer semantics | Medium | P4-F-CHROME-10 |
| M-06 CLS/admin readiness | Medium | P4-F-CHROME-11 |
| M-07 Font not delivered | Medium | P4-F-CHROME-11 |
| M-08 i18n not implemented | Medium | P4-F-CHROME-12 |
| M-09 High-contrast fixture absent | Medium | P4-F-CHROME-12 |
| L-01 Images lack dimensions | Low | P4-F-CHROME-11 |
| L-02 No app offline state | Low | P4-F-CHROME-09 |
| L-03 Sidebar 404 console noise | Low | P4-F-CHROME-09 |
| L-04 Contact copy/empty anchor | Low | P4-F-CHROME-05 |
| L-05 QA placeholder copy public | Low | P4-F-CHROME-05 |
| L-06 House 44 px targets | Low | P4-F-CHROME-06, P4-F-CHROME-10 |

## PO decisions required

1. Is the public portal in scope for multiple languages in this increment? If not, descope the switcher and locale fallback explicitly.
2. Is structured data (`Organization`, `WebSite`, `NewsArticle`) required for launch, or a later SEO increment?
3. What is the accepted production performance budget, test profile and browser/device support list?
4. Does "no unresolved high audit gaps" require a real screen-reader session before P4-F-CHROME closes? The audit assumes yes.
5. Provide the Azure DevOps Issue ID and connection so the evidence and fixture dump can satisfy AC-05.
