# Reproducing the P4-F-CHROME audit

This describes how to recreate the review environment and repeat the checks. It is a QA procedure, not a deployment guide. Use a disposable database/project; do not run the write test against shared QA data.

## 1. Baseline

- Repository: `D:/Projects/Website_Project/UoG-Website`
- Commit: `a4ecbe0`
- The worktree already contained the uncommitted P4-F-CHROME implementation at audit start. The audit changed no product code; `environment.json` lists those pre-existing files separately from the audit evidence.
- Compose project: `uog-digital-platform`
- Browser: Microsoft Edge `158.0.4370.33`, headless, Windows
- Accessibility engine: axe-core `4.14.0`
- Node used for the audit runner: `22.15.1`

## 2. Start the stack

```bash
cd /d/Projects/Website_Project/UoG-Website
docker compose up -d
docker compose ps
```

Expected healthy services and host ports:

| Service | Port |
|---|---|
| nginx (public entry point) | 80 |
| frontend-public | 3000 |
| frontend-admin | 3001 |
| backend | 8000 |
| Keycloak | 8080 |
| PostgreSQL | 5432 |
| MinIO | 9000–9001 |

The admin console is `http://localhost/admin`. The public Main Site is `http://www.uog.local/` through the local nginx/browser host mapping.

## 3. Restore the fixture snapshot

The dump at `review-fixtures.sql.gz` is a PostgreSQL 16.15 dump of the seeded review database:

- bytes: 382,123
- SHA-256: `8c5cd0f24b05b1fdf263a1454eb60239fe848808a22df67f0e9374289b76e0f5`

Restore it into a **disposable** PostgreSQL 16 instance/database with the same role and database names expected by the backend (`uog_admin` / `uog_db`). If the service configuration uses different names, restore into matching names in an isolated copy of the stack.

```bash
gunzip -c docs/qa/chrome-audit-2026-11-24/review-fixtures.sql.gz \
  | psql -h 127.0.0.1 -U uog_admin -d uog_db
```

The dump contains the schema as reviewed, including the uncommitted 0017 migration state. Do not point the restore at a database that another QA run is using.

Verify the expected seed shape:

```sql
select count(*) from sites_site;                  -- 102
select status, count(*) from sites_site group by 1; -- ACTIVE 87, ARCHIVED 15
select coalesce(configuration->'presentation'->>'theme','(default)') theme, count(*) from sites_site group by 1;
select coalesce(default_language,'(null)') locale, count(*) from sites_site group by 1;
select count(*) from cms_page;                    -- 902 at capture
```

At capture all 102 Sites were `institutional`, with `en` ×1 and `en-us` ×101. This is why high-contrast and multilingual conclusions are marked as verification gaps, not passes.

## 4. Resolve review hosts

For browser automation the audit used Chromium's host resolver:

```text
--host-resolver-rules=MAP *.uog.local 127.0.0.1
```

`.localhost` names already resolve to loopback. If using a normal browser, add these to the OS hosts file instead:

```text
127.0.0.1 www.uog.local
127.0.0.1 coi.uog.local
127.0.0.1 cmhs.uog.local
127.0.0.1 layout-45dfd491f4a.uog.local
127.0.0.1 article-media-post-14a6169c2f.uog.local
127.0.0.1 news-disabled-post-14a6169c2f.uog.local
127.0.0.1 aau-review.localhost
```

The exact target URLs are recorded in `public-run.json`, `metadata.json` and `responsive.json`.

## 5. Make the content read-only during the run

The post-run isolation proof held `SHARE` locks on content tables, which allow reads but block `INSERT`/`UPDATE`/`DELETE`. The earlier audit session used `ACCESS SHARE`, which does **not** block row writes, so AC-03 is only partially evidenced. Re-run under the `SHARE` lock below or against a frozen clone.

Start a separate session and hold the lock while auditing:

```sql
BEGIN;
LOCK TABLE cms_page, api_page, api_post, cms_menu, cms_menuitem,
           cms_menulocationassignment, sites_site, sites_siteheader,
           sites_sitefooter
  IN SHARE MODE;
SELECT pg_sleep(7);
COMMIT;
```

While it is held, a write attempt in another session with a short lock timeout must fail:

```sql
BEGIN;
SET LOCAL lock_timeout='400ms';
UPDATE cms_page SET title=title
WHERE sitecontent_ptr_id=(SELECT sitecontent_ptr_id FROM cms_page LIMIT 1);
COMMIT;
```

Observed result:

```text
ERROR: canceling statement due to lock timeout
```

The proof observed nine `ShareLock` locks on the listed tables, read pages continued to render, and the locking transaction committed/released normally. Do not rely on a long-lived lock for a manual review; use a transaction-scoped lock or a frozen clone. Record that the lock is held before the first audited page load, not only during a separate write test.

The admin screens were reviewed while signed in with the seeded development account documented in the repository. No save, publish, upload or delete action was performed.

## 6. Repeat the accessibility checks

For each public target and width:

1. Open the target in a fresh browser context at 1440×1000 and 390×844.
2. Wait for the app shell and any client panels to settle (the audit waited 1.2–2 s after `domcontentloaded`).
3. Inject `axe-core@4.14.0` and run WCAG 2.0/2.1/2.2 A/AA tags.
4. Record violations **and** incomplete results separately. Do not count `color-contrast` incomplete as a violation.
5. Capture a viewport screenshot and extract `document.title`, description, canonical, OG, H1s, landmarks and hreflang.

Repeat for the search dialog with a query that returns results (the audit used `QA`) and a query with no results, and for `http://coi.uog.local/#contact`.

Admin checks require a signed-in session; run axe on workspace, site dashboard, Appearance, Header, Footer, Menus, Pages, Posts, Media, Create Page and the Builder error URL. Capture `document.title` and all H1–H6 headings with each run.

The raw results in this folder were produced by Playwright-driven Edge. The runner scripts are not attached; they lived in ignored `.git/task-data/chrome-audit/` during the audit. The JSON formats and target lists are sufficient to reproduce the same checks with any Playwright/axe harness.

## 7. Repeat the responsive matrix

Use these widths on six representative templates: `home-main`, `page`, `posts`, `post-detail`, `category`, `home-empty` (the audit also ran target-level 1440/390 checks for sidebar, disabled modules and 404).

```text
320, 360, 390, 768, 1024, 1280, 1440, 1920
```

Record:

- `document.documentElement.scrollWidth > innerWidth + 1` (horizontal overflow)
- header height and whether the mobile trigger/desktop nav is active
- whether the brand text is clipped (`scrollWidth > clientWidth`)
- visible interactive targets under 44 px and under 24 px
- overflowing elements

320 px is used as the WCAG 1.4.10 reflow proxy for 400% zoom at a 1280 px viewport. This is not a substitute for testing browser zoom on a real display.

## 8. Repeat the performance measurements

The audit used Chromium `PerformanceObserver` for `paint`, `largest-contentful-paint` and `layout-shift`, with five public templates loaded in fresh contexts. This is **not** a Lighthouse run.

- Load each target at 1440×1000.
- Record FCP, LCP, cumulative CLS and every shift source.
- List image requests with natural/rendered size, `loading`, and `width`/`height` attributes.
- List font requests and inspect `document.fonts`.
- Repeat on a production build with the deployment cache/CDN and the agreed throttling profile before treating the dev-mode CLS as a release regression.

For admin readiness, navigate the same page three times and record time to the loading state disappearing plus network idle. Cold and warm values from the audit are in `admin-run.json` and `admin-warm.json`.

## 9. Evidence checks

- `environment.json` must parse and its fixture hash must match `review-fixtures.sql.gz`.
- `public-accessibility.json` contains 26 rows (13 targets × 2 widths).
- `responsive.json` contains 74 rows, including 48 matrix rows.
- `admin.json` contains 17 rows.
- Every finding in `README.md` links to at least one file in this folder.
- No product file should appear as an audit change. `git status --short -- docs/qa/chrome-audit-2026-11-24` should show only this evidence directory.

## 10. Not reproducible in this workspace

- **Azure DevOps attachment:** no connector or Issue ID was supplied.
- **Real screen reader:** no NVDA/Narrator session was run.
- **High-contrast public page:** no active high-contrast Site exists in the seed.
- **Multilingual public page:** no Site has more than one language.
- **Builder interaction:** the builder never reached a usable canvas; only the time to its error state was measured.
- **Non-Edge browsers/devices:** no Firefox, Safari/WebKit or physical iOS/Android device was used.
