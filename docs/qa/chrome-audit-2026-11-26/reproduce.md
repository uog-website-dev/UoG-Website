# Reproduce the 26 November 2026 chrome audit

Read-only. Do not publish, edit or delete CMS fixtures during the run.

## Prerequisites

- Healthy Compose stack (`uog-postgres`, nginx, public and admin frontends, API, Keycloak).
- Hosts resolve to `127.0.0.1`: `www.uog.local`, `coi.uog.local`, `*.uog.local`, `aau-review.localhost`.
- Edge at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` (or set `UOG_QA_BROWSER`).
- `axe-core` at `.git/task-data/release-tools/node_modules/axe-core/axe.min.js` (or set `UOG_QA_AXE_PATH`).
- `playwright-core` under `scripts/perf/node_modules`.
- Seeded Sites with POSTS, PAGES, MENUS and VISUAL_BUILDER where required.
- Keycloak `KEYCLOAK_DEV_USERNAME` / `KEYCLOAK_DEV_PASSWORD` in `.env` for admin only.

## Isolation (AC-03)

```bash
# Held automatically by scripts/qa-chrome-audit-runner.cjs
# Manual proof:
docker exec -i uog-postgres psql -U uog_admin -d uog_db -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
LOCK TABLE cms_page, api_page, api_post, cms_menu, cms_menuitem,
           cms_menulocationassignment, sites_site, sites_siteheader,
           sites_sitefooter IN SHARE MODE;
SELECT pg_sleep(60);
COMMIT;
SQL
```

In a second session, a timed UPDATE must fail with `lock_timeout` while reads succeed. See `isolation.json`.

## Collection

From the repository root:

```bash
node scripts/qa-chrome-audit-runner.cjs
node scripts/qa-chrome-audit-keyboard.cjs
node scripts/qa-chrome-audit-admin.cjs
node scripts/qa-chrome-audit-admin-site17.cjs
```

Outputs land in `docs/qa/chrome-audit-2026-11-26/`.

## Manual checks still required

- Real screen reader (NVDA/VoiceOver) on search, drawer, admin drawer and 404.
- High-contrast / alternate theme public fixture.
- Multilingual Site with language switcher and hreflang.
- Cross-browser: Chrome, Firefox, Safari; device lab for tablet navigation.
- Production or `next start` Lighthouse for CLS/LCP (dev lab CLS in this pack is not production evidence).
