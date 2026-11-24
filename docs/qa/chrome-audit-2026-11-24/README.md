# P4-F-CHROME public and admin chrome audit

**Audit date:** 24 November 2026  
**Repository baseline:** `a4ecbe0` (worktree already contained the uncommitted chrome implementation; the audit added evidence only)  
**Review environment:** seeded local Docker Compose stack (`uog-digital-platform`)  
**Status:** audit evidence and backlog complete; **Azure DevOps attachment (AC-05) is blocked** and **real screen-reader verification was not performed**

## 1. Purpose and recommendation

This audit covers the public and admin surfaces not assessed in the earlier P4-F-CHROME review: Page, Post list, Post detail, category archive, search results, 404, contact, sidebar layouts, empty/disabled/failure states, the admin shell, metadata, responsiveness, performance and i18n. It is read-only; no product code was changed.

**Recommendation: do not close P4-F-CHROME as complete.** The public templates have no axe-detected WCAG A/AA violations in the tested states, but there are **six high-severity findings**: a layout incompatibility that removes the Main Site homepage content and blocks the Visual Builder, desktop header brand clipping, soft-404 behaviour, missing crawl files, incomplete page metadata, and a serious accessible-name mismatch in the admin workspace. The audit also leaves material verification gaps that must be closed before a WCAG 2.2 AA claim: no real screen-reader run, no high-contrast public-Site fixture, no multilingual fixture, and no production-build performance baseline.

No **Critical** finding was recorded. "Critical" is reserved for a security, data-loss or total-service failure; the Main Site content failure is rated High because the affected layout is a QA seed page and the same defect must be confirmed against production content before release.

## 2. What was reviewed

### Public templates and states

| Surface | Target | Result | Evidence |
|---|---|---|---|
| Main homepage | `www.uog.local/` | **Fail:** content unavailable, brand clipped, metadata gap | `home-main-1440.png`, `home-main-390.png`, `home-main-320.png`, `metadata.json`, `responsive.json` |
| Child homepage | `coi.uog.local/` | Pass axe; brand clipped at 390; title gap; contact form present | `home-child-1440.png`, `home-child-390.png`, `contact-1440.png` |
| Page | `/mainqa-8995d437-information` | Pass axe/structure; brand clipped; generic description | `page-1440.png`, `page-390.png`, `page-768.png`, `metadata.json` |
| Post list | `aau-review.localhost/posts` | Pass axe; **CLS 0.309**; no description/canonical/OG | `posts-1440.png`, `posts-390.png`, `posts-320.png`, `performance.json`, `metadata.json` |
| Post detail | `/posts/aau-reference-dd1aa7a8` | Metadata present; **CLS 0.386**; images lack dimensions | `post-detail-1440.png`, `post-detail-390.png`, `performance.json`, `perf-detail.json` |
| Category archive | `/posts/categories/research-655af51c8f` | Pass axe; no description/canonical/OG | `category-1440.png`, `category-390.png`, `metadata.json` |
| Empty category | `/posts/categories/empty-655af51c8f` | Pass axe; empty state visible | `category-empty-1440.png`, `category-empty-390.png` |
| Search results | Header search dialog, query `QA` | Pass axe; **initial focus on dialog container** | `search-results-1440.png`, `search-results-390.png`, `search-results.json`, `search-contact.json` |
| 404 | `/does-not-exist-audit` | **Fail:** HTTP 200, no H1, generic title | `404-1440.png`, `404-390.png`, `http-checks.json`, `metadata.json` |
| Contact | `coi.uog.local/#contact` | Pass axe; contact form says submissions unavailable; empty `#contact` anchor | `contact-1440.png`, `contact-390.png`, `search-contact.json` |
| Left sidebar | `layout-45dfd491f4a.uog.local/left-sidebar` | Pass axe; sidebar renders | `sidebar-left-1440.png`, `sidebar-left-390.png` |
| Right sidebar | `layout-45dfd491f4a.uog.local/right-sidebar` | Pass axe; sidebar renders | `sidebar-right-1440.png`, `sidebar-right-390.png` |
| Empty homepage | `cmhs.uog.local/` | **Fail:** no H1, no description | `home-empty-1440.png`, `home-empty-390.png`, `metadata.json` |
| POSTS disabled | `news-disabled-post-14a6169c2f.uog.local/posts` | Pass axe; module state visible | `posts-disabled-1440.png`, `posts-disabled-390.png` |
| MENUS disabled | Sidebar page with menus disabled | Pass axe; sidebar 404s leave console noise | `menus-disabled-1440.png`, `menus-disabled-390.png`, `console-issues.json` |
| Homepage API 500 | Fault-injected homepage | Pass: accessible alert and Retry | `state-homepage-api-500.png`, `states.json` |
| Post list API 500 | Fault-injected post list | Pass: accessible alert and retry | `state-posts-api-500.png`, `states.json` |
| Offline navigation | Browser offline mode | No app-level offline state; Edge interstitial | `states.json` |

### Admin surfaces

| Surface | Result | Evidence |
|---|---|---|
| Workspace dashboard | **Serious accessible-name mismatch** on three workspace cards; H1 present | `admin-workspace-1440.png`, `admin-workspace-390.png`, `admin.json` |
| Site dashboard | Pass axe; H1 and section hierarchy present | `admin-site-dashboard-1440.png`, `admin-site-dashboard-390.png` |
| Appearance | Pass axe; H1 present; 6.8 s cold | `admin-appearance-1440.png`, `admin-appearance-390.png` |
| Header | Pass axe; H1 and six H2 sections | `admin-header-1440.png` |
| Footer | Pass axe; H1 present; 15.8 s cold | `admin-footer-1440.png`, `admin-footer-390.png` |
| Menus | **Accessible-name mismatch** on three reorder buttons; **no H1**; 18.9 s cold | `admin-menus-1440.png`, `admin-menus-390.png`, `admin.json` |
| Pages | **No H1**; 6.0 s cold | `admin-pages-1440.png` |
| Posts | **No H1**; 13.5 s cold | `admin-posts-1440.png` |
| Media | **No H1**; 12.8 s cold | `admin-media-1440.png` |
| Create Page | Pass axe; H1 present | `admin-page-new-1440.png` |
| Visual Builder | **Layout incompatibility error; no H1**; 20.8 s cold | `admin-builder-1440.png`, `admin-builder-390.png` |
| Mobile navigation | Focus trap/Escape/restore pass; drawer has no accessible name/role | `admin-mobile-nav-open.png`, `admin-mobile-keyboard.json` |

### Method

- **Accessibility:** axe-core 4.14.0 with WCAG 2.0/2.1/2.2 A/AA tags on every audited public template at 1440 and 390 px, the search result state, the contact section, and 11 admin screens at 1440/390 px; keyboard checks for the public drawer, search dialog, footer disclosure, admin workspace dialog and admin mobile drawer; DOM/heading/landmark inspection; manual contrast-token measurements. No real screen reader was used.
- **Responsive:** 320, 360, 390, 768, 1024, 1280, 1440 and 1920 px on six representative public templates (48 runs), plus target-level checks at 1440/390 on the full target set. Reflow was tested at 320 px, the WCAG 1.4.10 equivalent of 400% zoom at a 1280 px viewport.
- **Performance:** Chromium PerformanceObserver FCP/LCP/CLS, resource and long-task inspection on five public templates. This is equivalent lab evidence, **not a Lighthouse report**.
- **Isolation:** a PostgreSQL `SHARE` lock was held across the content tables while a write was attempted; the write failed with `lock_timeout` and reads continued. This proves the isolation method, but the earlier audit session used `ACCESS SHARE`, which **does not block row writes**; continuous write isolation during the audit itself is not proven.

The full environment record is in [environment.json](environment.json). Reproduction steps are in [reproduce.md](reproduce.md). Fixture dump SHA-256 is `8c5cd0f24b05b1fdf263a1454eb60239fe848808a22df67f0e9374289b76e0f5`.

## 3. Findings

Severity: **High** = blocks a core journey, materially harms accessibility/SEO, or blocks authoring; **Medium** = significant degradation or a required verification gap; **Low** = polish or house-standard deviation.

### H-01 — Main Site homepage content is unavailable and the Visual Builder cannot open affected Pages

**Severity:** High  
**Evidence:** `home-main-1440.png`, `admin-builder-1440.png`, `admin.json`, `console-issues.json`  
**Story:** P4-F-CHROME-07 (new)

`www.uog.local/` renders the header, footer and page title, then **"This page content is currently unavailable."** The same saved layout cannot be opened in the builder: Sites 102 and 16 draft Pages show **"This Page uses an unsupported or invalid layout. Its saved content has not been changed."** Four draft Pages across two Sites were checked; all failed the same way. This removes the public body and leaves authors with no editor.

**Repro:**

1. Open `http://www.uog.local/` at 1440 or 390 px.
2. Observe the message under "QA shared main homepage p4brand-0b2c8ca6".
3. Sign in to `http://localhost/admin` as the seeded developer user.
4. Open `http://localhost/admin/sites/102/admin/pages/180d0b82-420d-4d86-838d-d6fb33423029/builder`.
5. Observe the unsupported/invalid layout error with only "Back to Pages" and "Retry".

**Impact:** the primary public page has no content, and the recovery path for saved authoring data is unavailable. Determine whether the seed layouts are legacy/incompatible or whether a schema change made valid layouts invalid before treating this as production content loss.

### H-02 — Desktop header brand is visibly clipped at 1280–1920 px

**Severity:** High  
**Evidence:** `home-main-1440.png`, `page-1440.png`, `responsive.json`  
**Story:** P4-F-CHROME-03 (existing) and P4-F-CHROME-06 (existing)

At desktop widths the brand title truncates to "University of G…". The measured brand text box was `scrollWidth 184` against `clientWidth 159`. The defect is present at 1280, 1440 and 1920 px, and on some child-Site/mobile combinations at 320/360/390 px. Desktop navigation appears at 1280 px, which is exactly where the header loses enough width to clip the brand.

**Repro:**

1. Open `http://www.uog.local/` at 1280, 1440 or 1920 px with a cold viewport.
2. Inspect the site title in the header.
3. In DevTools, compare the brand text `scrollWidth` and `clientWidth`.

**Impact:** the institution's name is truncated on the primary desktop breakpoints; long or localised site names would be worse.

### H-03 — Unknown routes return a soft 404 with HTTP 200 and no H1

**Severity:** High  
**Evidence:** `404-1440.png`, `404-390.png`, `http-checks.json`, `metadata.json`  
**Story:** P4-F-CHROME-08 (new)

`/does-not-exist-audit` returns **HTTP 200** with `text/html`, the generic title "University of Gondar — Public Portal", a breadcrumb containing the missing path, and the body text "This Site has no published page to show." There is no H1 and no explicit "not found" heading. Search engines can index the route as a valid page, and assistive technology gets no page heading.

**Repro:**

1. `curl -i http://aau-review.localhost/does-not-exist-audit`
2. Observe `HTTP/1.1 200` and `content-type: text/html`.
3. Open the same URL in a browser and inspect the title, breadcrumbs and heading outline.

**Impact:** incorrect indexing, poor screen-reader orientation and misleading navigation for missing content.

### H-04 — `robots.txt` and `sitemap.xml` are soft-404 HTML pages

**Severity:** High  
**Evidence:** `http-checks.json`  
**Story:** P4-F-CHROME-08 (new)

Both `/robots.txt` and `/sitemap.xml` return **HTTP 200** with `content-type: text/html` and the Next.js document shell. There is no robots policy, no sitemap and no XML content. The favicon is correctly served as `image/x-icon`.

**Repro:**

1. `curl -i http://www.uog.local/robots.txt`
2. `curl -i http://www.uog.local/sitemap.xml`
3. Inspect the content type and first bytes; both are HTML.

**Impact:** crawlers receive invalid crawl directives and no canonical URL inventory. This is a release-level SEO defect for a public university portal.

### H-05 — Per-page metadata is incomplete on home, list and archive templates

**Severity:** High  
**Evidence:** `metadata.json`  
**Story:** P4-F-CHROME-08 (new)

- Home and child home use the global title **"University of Gondar — Public Portal"** instead of the Site/page name; description is only the Site display name.
- Post list and category archive have **no description, canonical or Open Graph metadata**.
- Page has a canonical but its description is the generic "University of Gondar", not the page summary.
- Post detail has a correct title, description, canonical and OG.
- No page in the audited set emits JSON-LD structured data or `hreflang`.

**Repro:** open each target and read the document head (`metadata.json` records the extracted values), or run `curl` and parse `<title>`, `meta[name=description]`, `link[rel=canonical]` and `meta[property^=og:]`.

**Impact:** weak search snippets and social cards on the templates that carry the news and category journeys. `hreflang` and structured data are not automatically defects for a single-language deployment, but the missing description/canonical/OG on list and archive routes is.

### H-06 — Admin workspace cards and footer reorder buttons fail accessible-name matching

**Severity:** High  
**Evidence:** `admin.json`, `admin-workspace-1440.png`, `admin-menus-1440.png`  
**Story:** P4-F-CHROME-10 (new)

axe reports `label-content-name-mismatch` (**serious**) at both 1440 and 390 px:

- Workspace cards: visible card text (e.g. "Organizations / Institutional structure") is not contained in the `aria-label` "Open the Organizations section".
- Menus: visible "Move footer column 1/2/3 left" controls do not match their `aria-label`.

**Repro:**

1. Sign in to `http://localhost/admin` and open the workspace dashboard.
2. Run axe or inspect the three workspace card action areas.
3. Open `http://localhost/admin/sites/17/admin/menus` and inspect the footer column reorder buttons.

**Impact:** screen-reader and voice-control users hear or must speak a different name from the visible label. This is a WCAG 2.5.3 failure and an axe serious result.

### M-01 — Empty-home fallback has no H1 and no page metadata

**Severity:** Medium  
**Evidence:** `home-empty-1440.png`, `home-empty-390.png`, `metadata.json`  
**Story:** P4-F-CHROME-01 (existing) and P4-F-CHROME-08 (new)

`cmhs.uog.local/` renders header, footer and the status text "This Site has no published page to show." There is **no H1**, no description and no canonical. The status is visible but is not a page heading, so the heading outline starts at the footer headings.

**Repro:** open `http://cmhs.uog.local/` and inspect the heading outline and document head.

### M-02 — Search dialog opens with focus on the dialog container, not the search field

**Severity:** Medium  
**Evidence:** `search-results.json`, `search-contact.json`, `keyboard.json`, `search-results-1440.png`  
**Story:** P4-F-CHROME-09 (new)

The search field declares `autoFocus`, but after opening the dialog the active element is `DIV` with no accessible label (the MUI dialog container). Keyboard users must press Tab before typing. Focus trapping, Escape and focus restoration pass.

**Repro:**

1. Open `http://www.uog.local/`, activate "Search this Site".
2. Wait 700 ms and check `document.activeElement`.
3. Type immediately; keystrokes do not reach the search input.

**Impact:** WCAG 2.4.3 focus-order friction in a primary public navigation control.

### M-03 — Public mobile drawer opens with focus on the drawer container

**Severity:** Medium  
**Evidence:** `keyboard.json`, `home-main-390.png`  
**Story:** P4-F-CHROME-09 (new)

The drawer traps focus, closes on Escape and restores focus to the trigger, but initial focus is on the drawer container rather than the close button. The close button is the first Tab stop.

**Repro:** at 390 px, open the navigation drawer with the keyboard and immediately inspect the active element.

### M-04 — Five admin screens have no H1 and all admin screens share a generic document title

**Severity:** Medium  
**Evidence:** `admin.json`, `admin-menus-1440.png`, `admin-pages-1440.png`, `admin-posts-1440.png`, `admin-media-1440.png`, `admin-builder-1440.png`  
**Story:** P4-F-CHROME-10 (new)

Menus, Pages, Posts, Media and the Builder error state contain no H1. Their first heading is H2 ("Pages", "Posts", "Media Library", "Template menu locations") or, in the Builder error, no heading at all. Document titles are repeated as **"Site administration · UoG Admin Console"** across Appearance, Header, Footer, Menus, Pages, Posts, Media and Builder, so browser tabs and history cannot distinguish them.

**Repro:** sign in, open each admin route, and inspect `h1` and `document.title`.

### M-05 — Admin mobile drawer has no accessible name or modal semantics

**Severity:** Medium  
**Evidence:** `admin-mobile.json`, `admin-mobile-keyboard.json`, `admin-mobile-nav-open.png`  
**Story:** P4-F-CHROME-10 (new)

The drawer root has `role="presentation"`; the paper has no role, `aria-label` or `aria-modal`. Its link accessible names concatenate title and description ("DashboardSite content overview"). Focus trap, Escape and focus restoration pass. Screen-reader users are not told that a navigation panel opened or what it contains.

**Repro:** at 390 px on the site dashboard, open "Open navigation menu" and inspect the drawer's roles and names.

### M-06 — Public CLS exceeds the 0.25 "poor" threshold on posts templates; admin routes are slow in development

**Severity:** Medium (must be re-measured on a production build)  
**Evidence:** `performance.json`, `perf-detail.json`, `admin-warm.json`, `admin.json`  
**Story:** P4-F-CHROME-11 (new)

| Template | FCP | LCP | CLS |
|---|---:|---:|---:|
| Home | 492 ms | 1,444 ms | 0 |
| Page | 616 ms | 1,596 ms | 0 |
| Post list | 588 ms | 1,956 ms | **0.309** |
| Post detail | 652 ms | 2,204 ms | **0.386** |
| Sidebar page | 516 ms | 1,532 ms | 0 |

LCP is within 2.5 s on every measured template. The shifts are attributed by the PerformanceObserver to `FOOTER` (post list) and two `DIV`s plus `FOOTER` (post detail). This is a development server without an extracted production CSS/font pipeline, so it is a **provisional** result; if it reproduces on a production build it is a High finding.

Warm admin navigation remained 4.8–7.5 s for Menus, Posts, Media, Footer, Create Page and the Builder error state. Cold runs reached 6.8–20.8 s. These are local dev timings, not a production benchmark, but they show that the authoring shell has not been performance-tested and that the Builder failure takes seconds to report.

**Repro:** load each target with a fresh Chromium context and collect `PerformanceObserver` entries for `paint`, `largest-contentful-paint` and `layout-shift`; repeat admin navigation three times.

### M-07 — The approved public font stack is not delivered

**Severity:** Medium  
**Evidence:** `perf-detail.json`  
**Story:** P4-F-CHROME-11 (new)

The computed body stack is `Inter, "Source Sans 3", "Helvetica Neue", Arial, sans-serif`, but the pages load **no font resources**, define no `@font-face` for Inter or Source Sans 3, and the only font objects in `document.fonts` are unloaded Next.js Geist faces. Most visitors therefore see Arial/Helvetica, not the approved typography. There is no preload or `font-display` policy because there is no delivered font.

**Repro:** open the post list, list network requests ending in `.woff/.woff2/.ttf/.otf`, and inspect `document.fonts`.

### M-08 — Public language switching is not implemented or exercisable

**Severity:** Medium (capability/verification gap)  
**Evidence:** `environment.json`; source note in `frontend/packages/ui/src/public-site-header.tsx`  
**Story:** P4-F-CHROME-12 (new)

All 102 seeded Sites are single-language (`en` ×1, `en-us` ×101), so no language switcher renders. The header component explicitly suppresses the switcher when fewer than two languages exist and comments that there are no locale-prefixed public routes. The only switcher code path changes `document.documentElement.lang`, not content. Menu/page locale fallback rules therefore could not be exercised.

**Impact:** the requirement "public language switching, menu and page locale behaviour, and fallback rules" has no working public implementation to audit. This may be an intentional scope decision, but it must be confirmed by the Product Owner rather than inferred from the absence of a control.

### M-09 — No active high-contrast Site exists, so the second theme is unverified end to end

**Severity:** Medium (verification gap)  
**Evidence:** `environment.json`, `contrast-incomplete.json`  
**Story:** P4-F-CHROME-12 (new)

All 102 Sites are `institutional`; none is `high-contrast`. The theme tokens pass the measured pairs (black/yellow 19.56:1, white/black 21:1) and the existing theme unit tests cover the pairs, but no public page, drawer, footer, form or error state was rendered in high contrast. The 10 axe `color-contrast` results are **incomplete** only because empty inputs have no value and one post link is overlapped; they are not violations.

**Impact:** the "contrast in both themes" requirement is only partially evidenced. Seed one active high-contrast Site and repeat the template matrix before claiming WCAG 2.2 AA across themes.

### L-01 — Content images have no intrinsic dimensions in markup

**Severity:** Low  
**Evidence:** `perf-detail.json`  
**Story:** P4-F-CHROME-11 (new)

All measured content and logo images lack `width`/`height` attributes. Post list has 5 lazy and 2 eager images; post detail has 1 lazy and 3 eager. Layout boxes are currently reserved by CSS (for example 366×206 cards and a 1152×440 hero), so images did not cause the measured shifts. The lack of intrinsic dimensions remains a CLS and art-direction risk once images or breakpoints change.

**Repro:** inspect `document.images` on `/posts` and the post detail page.

### L-02 — No app-level offline state

**Severity:** Low  
**Evidence:** `states.json`  
**Story:** P4-F-CHROME-09 (new)

With the network offline, navigating to the post list produces the Microsoft Edge `ERR_INTERNET_DISCONNECTED` interstitial, not an app-rendered offline message. Server-rendered content already on screen remains usable, but the product has no controlled offline/failure shell.

### L-03 — Optional sidebar APIs log 404 console errors when modules are disabled

**Severity:** Low  
**Evidence:** `console-issues.json`, `menus-disabled-1440.png`  
**Story:** P4-F-CHROME-09 (new)

On sidebar layouts without the relevant modules, `/api/v1/site-context/pages/` and `/api/v1/site-context/menus/?location=sidebar` return 404 and appear as failed requests in the console, while the page still renders its fallback. The user-facing state is acceptable; the console noise makes real failures harder to detect.

### L-04 — Contact entry is an empty anchor and the published form says it is unavailable

**Severity:** Low  
**Evidence:** `contact-1440.png`, `contact-390.png`, `search-contact.json`  
**Story:** P4-F-CHROME-05 (existing)

The child-Site contact navigation points to `#contact`, which resolves to an empty `<div id="contact">` inside the menu-anchor widget; the contact form follows in the next row. The form itself is present with Name, Email and Message labels and passes axe, but its copy says: **"This form is available for submission after the Page completes its publishing workflow."** on a page that is publicly reachable. The main Site has no local contact template; its Contact links go to `https://uog.edu.et/contact-us/`.

**Impact:** visitors reach a contact area whose submission state is ambiguous, and the main Site has no in-product contact template to audit.

### L-05 — QA/placeholder copy is visible on the seeded public Site

**Severity:** Low (environment content, not a code defect)  
**Evidence:** `home-main-1440.png`, `metadata.json`  
**Story:** P4-F-CHROME-05 (existing)

The public Main Site H1 is "QA shared main homepage p4brand-0b2c8ca6"; footer headings include "Main review mainqa-8995d437 …" and "University Main - Footer". This is seeded QA content, not production copy, but it demonstrates why the proposed P4-F-CHROME-05 pre-publish lint/publish gate is needed.

### L-06 — Several controls are below the house 44 px target

**Severity:** Low  
**Evidence:** `responsive.json`, `admin.json`  
**Story:** P4-F-CHROME-06 (existing) and P4-F-CHROME-10 (new)

Public breadcrumb links and "In this section" measured 17–23 px high; filter buttons and inputs 37–40 px; admin reorder/Retry controls 37 px. WCAG 2.2 AA's 24×24 target-size rule has exceptions for inline links and did not produce axe failures, so this is a **house-standard** gap rather than a confirmed AA failure. It does affect touch comfort at 320–390 px.

## 4. Passes and non-findings

- Public axe: **0 violations** across 26 template/width runs. The 10 `color-contrast` results are incomplete, not violations (empty inputs or an overlapped link).
- Public landmarks: one header, one main and one footer on every tested template; navigation landmarks are labelled.
- Heading order: no skipped-level axe failures on public templates. Admin heading levels are sequential but start at H2/H6 where H1 is missing (M-04).
- Public mobile drawer: focus trap, Escape and focus restoration pass; only initial focus is wrong (M-03).
- Search dialog: focus trap, Escape, restoration, result links and no-result status pass; only initial focus is wrong (M-02).
- Footer disclosure: keyboard operable, `aria-expanded` changes correctly.
- Widths: no horizontal overflow at 320, 360, 390, 768, 1024, 1280, 1440 or 1920 px. Header heights: 67–71 px mobile, 107 px without menus, 160 px desktop.
- API 500: homepage and post list render accessible alerts with retry actions.
- Favicon: `/favicon.ico` returns 200 `image/x-icon`.
- Default institutional contrast pairs: white/navy 12.61:1, ink/gold 9.11:1, ink/mist 14.69:1. High-contrast tokens: black/yellow 19.56:1, white/black 21:1.
- Admin focus: workspace switcher and site navigation keyboard access pass on desktop; admin mobile drawer traps focus, Escape closes and focus returns to the trigger.
- Sidebar layouts, empty category and disabled-module states render without axe violations.

## 5. Acceptance criteria status

| AC | Status | Note |
|---|---|---|
| AC-01 — every audited surface has severity, evidence and reproduction path | **Met** | 21 findings and the surface tables above; evidence files are in this folder. |
| AC-02 — findings mapped to an existing or new P4-F-CHROME story | **Met** | Existing 01/03/05/06 plus proposed 07–12 in [BACKLOG.md](BACKLOG.md). |
| AC-03 — reproducible, isolated review environment | **Partially met** | A fixture dump, environment record and a successful `SHARE`-lock write-block proof are included. However the audit session itself used `ACCESS SHARE`, which does not block writes, so continuous write isolation during the audit is not proven. The browser/audit runner scripts live in ignored `.git/task-data` and are not attached; [reproduce.md](reproduce.md) gives the commands. |
| AC-04 — no product code modified by the audit | **Met** | The only audit addition is `docs/qa/chrome-audit-2026-11-24/`; `environment.json` records the pre-existing dirty chrome implementation files. |
| AC-05 — evidence attached to the Azure DevOps Issue | **Not met — blocked** | No authenticated Azure DevOps connector or issue identifier is available in this workspace. Attach this folder and `review-fixtures.sql.gz` once the Issue ID and connection are supplied. |
| AC-06 — backlog reviewed and prioritised with the Product Owner | **Pending** | [BACKLOG.md](BACKLOG.md) proposes the order; PO sign-off is still required. |

**Definition of Done is not met**: AC-05 and AC-06 remain open, a real screen-reader run was not performed, and the high-contrast/multilingual fixtures are absent.

## 6. Verification gaps and limitations

1. **No real screen reader.** No NVDA, Narrator or VoiceOver session was run. The evidence is axe, DOM/heading/landmark inspection and keyboard automation. This is a High audit gap against the required "manual keyboard and screen-reader notes"; do not claim screen-reader acceptance until an AT session is recorded.
2. **No high-contrast public fixture.** All 102 Sites are institutional. Tokens and unit tests pass; the rendered public high-contrast experience is unverified.
3. **No multilingual fixture.** All Sites use one of `en`/`en-us`; the public switcher does not render and locale fallback cannot be tested.
4. **Audit-run write isolation is not proven.** The earlier session used `ACCESS SHARE`, which does not block row writes. The stronger `SHARE` test was executed after the audit and proves the method, not the original run. No fixture change was observed, but AC-03 must be treated as partial.
5. **Builder interaction latency not measured.** The builder never reached a usable canvas because of H-01. Only time-to-error was measured (5.8–6.5 s warm, 20.8 s cold).
6. **Performance is development-mode only.** CLS/LCP were measured against the dev server without a production build, CDN, cache or throttling. The CLS result must be reproduced against a release build before it is treated as a production regression. No Lighthouse run was performed; the method is PerformanceObserver, an equivalent lab signal.
7. **Cross-browser/device matrix is incomplete.** Only headless Microsoft Edge 158 on Windows was used. Firefox, Safari, iOS/Android devices and real touch hardware were not tested. The width matrix is viewport emulation, not physical-device evidence.
8. **Contact submission was not exercised.** The form was inspected and axe-tested but not submitted; its copy says submission is unavailable.
9. **No production content validation.** The layout incompatibility is demonstrated on QA seed pages. Production pages must be inventoried before deciding whether H-01 is a migration defect or a fixture-only issue.

## 7. Evidence index

- `public-accessibility.json` — axe results for 26 public template/width runs.
- `responsive.json` — 74 responsive rows, including the 48-run 320–1920 matrix.
- `metadata.json` — title, description, canonical, OG, H1, landmarks and hreflang extraction.
- `performance.json`, `perf-detail.json` — FCP/LCP/CLS, shifts, fonts and images.
- `keyboard.json`, `search-results.json`, `search-contact.json`, `contrast-incomplete.json` — keyboard, search, contact and manual contrast evidence.
- `states.json`, `http-checks.json`, `console-issues.json` — API/offline failure, HTTP and console evidence.
- `admin.json`, `admin-run.json`, `admin-warm.json`, `admin-keyboard.json`, `admin-mobile.json`, `admin-mobile-keyboard.json` — admin axe, timing, headings and keyboard evidence.
- `*.png` — public templates at 1440/390, width probes at 320/768, admin screens, builder/mobile navigation and API failure screenshots.
- `review-fixtures.sql.gz` — content fixture dump.
- `environment.json` — baseline, services, tools, fixture counts, hashes and isolation proof.
- `reproduce.md`, `BACKLOG.md` — reproduction instructions and prioritised backlog.

## 8. Next increment recommendation

1. **Fix H-01 first.** Inventory saved layouts and restore a supported builder/public renderer path. Until authors can open a Page, no other content-authoring fix can be verified end to end.
2. **Ship the four small public fixes together:** P4-F-CHROME-03 brand clipping, P4-F-CHROME-08 metadata/crawl/404 semantics, P4-F-CHROME-10 admin accessible names/H1s, and P4-F-CHROME-09 focus/offline states.
3. **Re-run the audit under a real `SHARE` lock or a frozen clone** so AC-03 is fully evidenced, then run the missing verification before any WCAG claim: NVDA/Narrator pass, a high-contrast active Site, a two-language Site, production-build CLS/LCP, and Firefox/Safari/real mobile.
4. **Then attach evidence to Azure DevOps and hold the PO prioritisation review (AC-05/AC-06).**
