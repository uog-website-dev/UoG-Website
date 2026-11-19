# P4-HOME-002 starter homepage verification — 19 November 2026

Local implementation and QA evidence for University Main and College/Department starter templates. This report records the tests executed in the development Compose environment; it is not code review approval or an Azure DevOps release sign-off.

## Results

| Area | Result | Evidence |
| --- | --- | --- |
| Backend template, authorization, module-gate and draft-save tests | Passed | 15 tests in `test_homepage_templates.py` |
| Backend public widget and Site-isolation tests | Passed | 6 tests in `test_widget_runtime.py` |
| Frontend widget runtime tests | Passed | 10 tests in `widget-runtime.test.tsx` |
| Admin template catalogue and Visual Builder tests | Passed | 7 catalogue tests and 25 builder tests |
| TypeScript | Passed | UI package and admin-web typechecks |
| Browser workflow | Passed | [Browser results](browser.json) |
| Mobile accessibility | Passed | Zero axe violations for both saved templates; [University Main](university-main-public-accessibility.json), [College/Department](college-department-public-accessibility.json) |
| Django system check | Passed | No issues |
| Migration drift | Passed | `makemigrations --check --dry-run`: no changes detected |
| OpenAPI | Passed | `spectacular --validate --fail-on-warn`; API contract unchanged |
| Diff hygiene | Passed | `git diff --check`; browser script `node --check` |

The focused backend run was `pytest apps/cms/tests/test_homepage_templates.py apps/cms/tests/test_widget_runtime.py -q` inside the Compose backend. Frontend checks used the pinned workspace dependencies. No database migration or OpenAPI change was needed.

## Browser and design review

The Playwright rehearsal authenticated a generated Site Editor, opened the existing Visual Builder, previewed both templates, selected and saved each draft, opened the full private Page preview, and reloaded the saved draft. It used a generated child Site with MENUS, PAGES, VISUAL_BUILDER and POSTS enabled and no published Posts.

Checks passed for Site identity/menu binding, empty Site news state, unavailable logo placeholder, draft-only selection, save/reload, no publication, and no horizontal overflow at 390 px. A separate 1440 px builder preview was reviewed. Both saved page previews had zero axe violations across WCAG 2 A/AA and WCAG 2.1 AA rules (24 passing rules each).

| Template | Desktop full-page preview | Mobile 390 px preview | Builder preview |
| --- | --- | --- | --- |
| University Main | [Screenshot](university-main-public-desktop.png) | [Screenshot](university-main-public-mobile.png) | [Screenshot](university-main-desktop.png) |
| College/Department | [Screenshot](college-department-public-desktop.png) | [Screenshot](college-department-public-mobile.png) | [Screenshot](college-department-desktop.png) |

The backend/API suite also covers anonymous and unauthorized access, foreign Site denial, disabled builder modules, widget module gates, cross-Site menus and news, and foreign media references. A generated independent Site was used for isolation checks. The browser session was Site-scoped to a generated child Site; it did not alter an actual Main Site.

## Cleanup and release tracking

The generated browser identities were disabled, their temporary memberships revoked, and the mode-restricted session file removed. Generated Site and content fixtures remain in the local development database as QA history.

No Azure DevOps or PR connector is available in this session. The test report and screenshots are ready in this directory, but attaching them to Issue P4-HOME-002 and linking a PR remain release-tracking steps. Code review approval and critical/high defect review are also outside this local test run.
