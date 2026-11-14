# Ordered menu destinations — QA evidence

Date: 14 November 2026. Branch: P4-MENU-001 working-tree follow-up for P4-MENU-002. This evidence uses the local Docker Compose environment with PostgreSQL, Django, real Keycloak, Next.js and Nginx. It is implementation evidence, not a signed release approval.

## Final results

- [Backend JUnit](backend-tests.xml): **90 passed**, zero failures/skips. Covers destination CRUD and publication snapshots, existing Menu API/integrity/delivery/directory regressions and sidebar compatibility. The final run used a fresh database with all migrations, including 0026.
- [Editor component JUnit](admin-tests.xml): **20 passed**. Includes Page/category/news creation, accessible move/nest controls, stale conflict feedback, disabled/unauthorized/empty states and late selected-menu responses.
- Workspace TypeScript, admin isolated production build, Django system check, OpenAPI validation (`spectacular --validate --fail-on-warn`) and migration drift check passed. Console evidence: [TypeScript](typecheck.txt), [admin build](admin-build.txt), [backend](backend-tests.txt), [components](frontend-tests.txt). The [OpenAPI baseline](../../api/openapi.yaml) was regenerated.
- [Migration rehearsal](migration-rehearsal.json): 0025/0026 forward and reverse preserved 13 menus and 12 items, IDs, versions, timestamps, assignments and ordering. Fresh-database CI integration additionally applies the migration. API regression tests reject downgrade while unpublished item changes remain, and the existing sidebar downgrade guard still works after 0026.
- [Real Keycloak workflow](browser-results.json): four passing checks. Editor adds a published Page, news listing, published category and safe external link; keyboard reorder and nesting stay private; an independent Site remains unchanged; Publisher promotes the changed tree. [Editor desktop](editor-desktop.png), [Editor phone](editor-mobile.png), [Publisher](publisher-desktop.png).
- [Public browser result](public-results.json): ordered published links, Page/category destinations and keyboard operation through the collapsed mobile navigation passed at 1440px and 390px. [Desktop](public-desktop.png), [phone](public-mobile.png). The Site root intentionally uses the existing no-homepage fallback; the navigation remains usable there.
- [Automated accessibility](accessibility-results.json): zero WCAG 2 A/AA and WCAG 2.1 AA axe violations in the administration screen at 1440px and 390px (27 passing rules at each width). Manual scripted keyboard checks cover editor reorder and public mobile navigation open/focus traversal. This does not claim complete assistive-technology certification.
- [Identity cleanup](cleanup.json): both generated Keycloak identities disabled, local identities disabled, memberships revoked and private session/credential file removed. An initial rehearsal's identities were also retired. Audited Site content is retained. Passwords/tokens are excluded from the artifacts.

## Acceptance coverage

| AC | Evidence |
| --- | --- |
| 1 | Page/Post API target regression; real Editor adds approved Page/external link |
| 2 | Private-tree snapshot/reorder/nesting integration; Publisher and public browser checks |
| 3 | Existing cycle/depth and atomic move tests; new cycle-without-side-effects test |
| 4 | Existing URL matrix and new script-scheme rejection test |
| 5 | Foreign Page API/service rejection, forged Category ID and raw database ownership guard |
| 6 | Unavailable destination status, picker exclusion and publication rejection with unchanged public tree |
| 7 | Stale reorder returns 409 and keeps the latest tree; existing concurrent aggregate tests |
| 8 | Published order/content retained after draft move/delete; imported active menu frozen on first API edit |
| 9 | Existing API/service permission and disabled-role tests; Editor denied promotion; module-gate tests |

Category-only retargeting is tested separately for a changed aggregate ETag and an actor/Site audit event; this guards against changes invisible to the existing audit whitelist. Source-module shutdown is checked against already-requested public menu results so stale cache entries cannot preserve those links.

## Reproduction

Backend: `pytest apps/cms/tests/test_menu_destinations.py apps/cms/tests/test_menu_api.py apps/cms/tests/test_menu_delivery.py apps/cms/tests/test_menu_directory.py apps/cms/tests/test_menu_integrity.py apps/cms/tests/test_sidebars.py apps/cms/tests/test_sidebar_widgets.py -q --create-db --reuse-db --junitxml=/tmp/menu-destinations-backend.xml`.

Frontend: `pnpm --filter @uog/admin-web test -- src/sites/menu-items.test.tsx src/sites/site-menus.test.tsx`.

Repeatable scripts: [seed](../../../scripts/qa-menu-destinations-seed.py), [role handoff browser](../../../scripts/qa-menu-destinations-browser.cjs), [public browser](../../../scripts/qa-menu-destinations-public.cjs), [accessibility](../../../scripts/qa-menu-destinations-accessibility.cjs), [migration rehearsal](../../../scripts/qa-menu-destinations-migrations.py), [cleanup](../../../scripts/qa-menu-destinations-cleanup.py). Seed/cleanup use development-only private configuration on stdin and a temporary private session file; never commit it. The public check reads the safe run identifier from cleanup evidence. Run migration rehearsals before creating new typed items, or use an exported/restored baseline. Reusing a test database after transaction tests can remove migration seed rows; use `--create-db` for the recorded baseline.

The browser harness waits for a confirmed item-tree refresh between moves. The first walkthrough exposed a stale test action when it issued two moves too quickly; the backend correctly rejected it rather than overwriting the tree. The mobile public harness opens the responsive drawer by keyboard before focusing links. Final runs above pass.

## Release status

0026 is applied locally, the updated administration dev server is refreshed, and real public navigation was verified. [Destination, publication, permissions and rollback guidance](../../menu-destinations.md) documents the contract. No remote production deployment, PR creation, external approval or Azure DevOps attachment was performed. A reviewer and Issue/PR destination are still needed for those release steps.
