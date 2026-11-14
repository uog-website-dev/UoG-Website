# Page layout acceptance evidence — 2026-11-14

Implemented against the local working tree based on commit `f232ee5b11b77896c9a0c498c3a0afdc89a5a0f6`. Source hashes are recorded in `source-manifest.json`.

## Result

Full Width, Left Sidebar and Right Sidebar use the existing Page layout field and revision workflow. No database migration was added: the pre-change database inventory contained 21 Pages with empty layout values, and revision/restore/publication payloads already included the field. Empty, STANDARD and LANDING remain full-width compatibility aliases.

| Acceptance criterion | Evidence | Actual outcome |
| --- | --- | --- |
| Full Width without sidebar space | `backend-tests.xml`, `ui-tests.xml`, viewport screenshots | Content-only grid; existing builder width setting preserved |
| Left/Right Sidebar position | `browser-results.json`, desktop screenshots | Correct desktop position for both sides |
| Content and revisions preserved | `backend-tests.xml`, `admin-tests.xml`, `revision-regressions.xml` | Exact builder tree retained; layout-only PATCH; previous revision retained |
| Narrow viewport reading order/overflow | `browser-results.json`, `accessibility-results.json` | Content then navigation at 390/768px; no horizontal overflow |
| Unsupported ID rejected | `backend-tests.xml` | Field-specific layout errors; invalid creates do not persist |
| Draft/public isolation | `backend-tests.xml`, `browser-results.json` | Draft change stays private; reviewed publication promotes layout atomically |
| Edit permission enforced | `backend-tests.xml` | Reviewer/Publisher cannot edit layout |
| Site/module boundaries | `backend-tests.xml`, `browser-results.json` | Foreign writes denied; disabled PAGES write returns existing module-disabled error; second Site unchanged |

## Automated checks

- Backend Page layout + existing Page API: **21 passed**, [JUnit](backend-tests.xml).
- Existing Page model and legacy-layout compatibility: **12 passed**, [JUnit](model-regressions.xml).
- Revision API, revisions and working drafts: **14 passed**, [JUnit](revision-regressions.xml).
- Admin Page editor and media-picker regression: **25 passed**, [JUnit](admin-tests.xml).
- Shared public Page renderer and shell: **16 passed**, [JUnit](ui-tests.xml).
- Workspace TypeScript: **passed** across all five packages with checks.
- Admin and public Next.js production builds: **both passed**, using the isolated-build helper; no running dev build output was overwritten.
- Django system check: **0 issues**. Migration drift check: **no changes detected**.
- OpenAPI generation with `--validate --fail-on-warn`: **passed**; [schema](../../api/openapi.yaml) updated.

Backend commands: `pytest apps/cms/tests/test_page_shell_layouts.py apps/cms/tests/test_page_api.py -q --reuse-db` and `pytest apps/cms/tests/test_working_draft.py apps/cms/tests/test_revision_api.py apps/cms/tests/test_revisions.py -q --reuse-db`. Frontend commands target `site-pages.test.tsx`, `media-picker-save.test.tsx`, `page-shell.test.tsx`, and `public-page.test.tsx`.

## Real-browser evidence

Windows headless Edge **157.0.4341.46**, real Next.js/Django/PostgreSQL/Keycloak services behind Nginx. Two newly generated Site hostnames, a real Site Editor identity, three published visual layouts in Site A and one independent Page in Site B. The visual fixture includes a stable-ID 60/40 row and retained headline.

- [Browser results](browser-results.json): **12 checks passed**, including nine layout/viewport combinations, independent Site, actual Editor select → private preview → save → reopen, and unchanged public snapshot after draft save.
- [Accessibility results](accessibility-results.json): **nine scans**, no automated WCAG A/AA violations or incomplete checks within the Page shell. Actual Tab traversal reached the next sidebar link at all tested widths. This is scoped component evidence, not a whole-product accessibility certification.
- [Desktop left sidebar](left_sidebar-1440.png), [desktop right sidebar](right_sidebar-1440.png), [phone stacking](left_sidebar-390.png), [Editor preview](editor-draft-preview.png). All nine viewport screenshots are alongside this report.
- Browser scripts: `scripts/qa-page-layout-seed.py`, `scripts/qa-page-layout-browser.cjs`, `scripts/qa-page-layout-accessibility.cjs`, `scripts/qa-page-layout-cleanup.py`. Supply backend-only configuration and temporary identity JSON through stdin; never commit the private session file. Playwright/axe paths are supplied by `UOG_QA_PLAYWRIGHT_ROOT` and `UOG_QA_AXE_PATH`.
- Initial rehearsal setup failures were corrected before the recorded passing run: activate fixture domains, reload Nginx upstream addresses, and restart development frontends because Windows bind-mount watching retained an old renderer. Fixture publication correctly rejected self-review; seed actors were separated. No authorization checks were bypassed.
- [Cleanup](cleanup.json): generated Keycloak account disabled, memberships revoked, local identity disabled, private credential file removed. Generated audited content remains as repeatable public fixture evidence. An interrupted seed identity was also disabled before the successful seed.

## Review handoff

User guidance: [Page layouts](../../page-layouts.md). Independent code review/approval, PR creation and Azure Issue attachment require the project review workflow; they are not represented as completed by these local results. No migration rollback is required because this change adds no schema/data migration. Rolling back code restores the prior shell renderer while retaining existing layout values and builder documents.
