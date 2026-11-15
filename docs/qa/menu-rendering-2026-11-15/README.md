# Menu rendering and preview verification ? 15 November 2026

Local implementation evidence, not external review approval. Real Docker Django/PostgreSQL/Redis/Keycloak and Next.js services were used through nginx on port 80; headless Microsoft Edge exercised real Editor login and Publisher promotion. Generated run: `menurender-f89f289c69`, independent Sites 77 and 78. No schema change or migration is required.

## Automated results

| Scope | Result | Evidence |
| --- | --- | --- |
| Backend preview, delivery, assignments, sidebars | 48 passed | [JUnit](backend-tests.xml), [output](backend-tests.txt) |
| Admin preview and menu controls | 23 passed | [JUnit](admin-tests.xml), [output](admin-tests.txt) |
| Shared navigation, sidebar, visual rendering | 88 passed | [JUnit](shared-tests.xml), [output](shared-tests.txt) |
| Workspace TypeScript | Passed | [output](typecheck.txt) |
| Admin production build | Passed | [output](admin-build.txt) |
| Public production build | Passed | [output](public-build.txt) |
| Django checks / migration drift | No issues / no changes | Command checks completed locally |
| OpenAPI validation | Passed with fail-on-warn | Updated `docs/api/openapi.yaml` |

## Acceptance matrix

| Criteria | Expected and observed |
| --- | --- |
| AC01 locations/shared Sites | Explicit Publisher promotion rendered header, utility, footer and sidebar on generated pilot Site. Main Site assignment behavior is covered by backend location tests; existing Main Site browser run verified the shared empty-slot fallback, not a newly assigned Main menu. |
| AC02 keyboard/focus | Nested links reached by keyboard, visible outline and current-page indication; mobile Escape restored focus. Component tests cover native disclosure Escape. |
| AC03 mobile | 1440, 768 and 390 px checks passed without horizontal overflow; mobile opens, dismisses and follows nested links. |
| AC04 destinations | Browser link activation retained the Site hostname/path; backend regression checks canonical inherited origins under HTTP/HTTPS. |
| AC05 private preview | Editor opened full-page saved-draft preview in a new tab; anonymous navigation stayed unchanged until separate Publisher promotion. Anonymous API access denied. |
| AC06 isolation | Foreign Site preview denied; backend checks omit foreign/unpublished branches and prevent private parent-draft inheritance. Independent Site unchanged. |
| AC07 fallback | Empty Main location, missing domain, unavailable preview nodes, malformed trees and failed responses covered by browser/components/API tests. |
| AC08 module | Disabling generated Site MENUS returned public 404, removed header/sidebar navigation and retained readable Page; re-enable restored approved navigation. |

[Private browser results](private-browser.json), [public browser results](public-browser.json), [publication](publication.json), [module-off](module-browser.json), [restoration](module-restored.json), [recovery](recovery.json). Private axe scan: zero violations, 25 passing rules; public scan: zero violations, 23 passing rules for WCAG 2 A/AA and 2.1 AA tags. These automated scans supplement the recorded keyboard checks and are not a complete accessibility certification.

Screenshots: [desktop preview](preview-desktop.png), [mobile preview](preview-mobile.png), [1440 px public](public-1440.png), [768 px public](public-768.png), [390 px public](public-390.png), [Main fallback](main-fallback.png), [module disabled](module-off.png).

## Reproduction and disposition

The `scripts/qa-menu-rendering-*` scripts seed isolated development Sites and real identity profiles, run private browser assertions, explicitly publish, run public assertions, disable/re-enable MENUS and clean up. They require the development Compose stack, private seed configuration and Playwright/axe paths; never commit session credentials. The seed's `/tmp/menu-rendering-session.json` must remain private. Browser scripts use Edge with a localhost hostname resolver for generated `*.uog.local` hosts.

Backend command: `pytest apps/cms/tests/test_menu_preview.py apps/cms/tests/test_menu_delivery.py apps/cms/tests/test_menu_locations.py apps/cms/tests/test_sidebars.py apps/cms/tests/test_sidebar_widgets.py -q --create-db --reuse-db`. Admin checks target `menu-preview.test.tsx`, `site-menus.test.tsx`, `menu-locations.test.tsx`; shared checks target `site-navigation.test.tsx`, `reusable-sidebar.test.tsx`, `visual-layout.test.tsx`. Production builds use `scripts/qa/sprint3/build-isolated.mjs` for each app.

[Cleanup](cleanup.json) confirms both generated accounts disabled, Site memberships revoked and private session removed. Generated published fixtures remain for local inspection; no production Site was modified. Module state was restored. [Source hashes](source-manifest.json) identify the working source, including pre-existing concurrent domain-link edits; they are not a commit or signed release identifier.

No blocking defect was observed in this scoped run. External code review/approval, CI execution, PR creation and Azure Issue attachment remain pending. No Issue identifier was supplied. Do not treat this report as a signed sprint acceptance.
