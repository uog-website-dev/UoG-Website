# Menu location acceptance verification

Date: 15 November 2026 (Africa/Addis_Ababa).

AC-01 through AC-09 have automated coverage. This follow-up adds explicit negative checks for foreign-Site reads, draft writes and publication against an existing assignment, with unchanged-row assertions. It also covers anonymous requests, cached public delivery during MENUS disable/re-enable, and assignment/public delivery for the Main Site using the same shared services. No production implementation change or migration was needed in this follow-up.

## Results

- [Backend acceptance JUnit](backend.xml): **12 passed**, zero failures/skips, on a fresh PostgreSQL test database with migrations applied.
- [Administration component JUnit](frontend.xml): **18 passed**, zero failures/skips. Covers replacement confirmation, separate Save/Publish, unassignment, permission controls, Site-change clearing and recoverable errors.
- [Public component evidence](../menu-locations-2026-11-14/public-components.xml): 36 passing tests from 14 November. Public renderer code has not changed in this follow-up.
- [Real Keycloak/browser workflow](../menu-locations-2026-11-14/browser-results.json): six passing checks from 14 November, including four-slot public rendering, independent Site output, private assignment drafts and published unassignment. This follow-up links that recorded run; it does not claim a new browser run.
- [Standard-port authenticated verification](../menu-locations-2026-11-14/standard-ports.json), [responsive/accessibility evidence](../menu-locations-2026-11-14/README.md) and [migration rehearsal](../menu-locations-2026-11-14/migration-rehearsal.json).

## Criteria matrix

Tests are in [test_menu_locations.py](../../../backend/apps/cms/tests/test_menu_locations.py).

| AC | Automated evidence | Browser/public evidence |
| --- | --- | --- |
| 01: published Primary Header | `test_explicit_replace_draft_publish_and_unassign_preserve_menus`; Main Site shared-path test | Published header replacement and public Page |
| 02: independent Footer/Sidebar | Same API lifecycle test verifies all three destinations independently | All four locations render independently; Site B unchanged |
| 03: unsupported identifiers | Scope/database guard test; restricted template test | UI lists supported registry slots only |
| 04: assignment conflicts | Explicit replacement rejection; two-thread creation has one winner and one conflict; stale versions rejected | Replacement confirmation and separate publication |
| 05: forged foreign menu | API input rejection and raw database ownership rejection | Client options are Site-filtered in component tests |
| 06: unassignment retains menu | Published null assignment hides slot while Menu IDs/items remain | Public Header removed while other slots remain |
| 07: private assignment draft | Saved replacement stays private; unpublished menu promotion rejected | Save Draft leaves public navigation unchanged |
| 08: unauthorized foreign admin | Parametrized read/draft/publish requests return 403, expose no foreign label and leave all assignment fields unchanged; anonymous returns 401 | Permission-aware controls and Site-change isolation components |
| 09: legacy compatibility | Restricted-template/legacy fallback test and existing delivery regressions | Existing public navigation before explicit assignment |

Additional module test verifies public 404 while MENUS is disabled, both write operations denied without changing the assignment, and the same published navigation restored after re-enable. Main Site coverage confirms no college-specific authorization or assignment path.

## Commands

Backend: `pytest apps/cms/tests/test_menu_locations.py -q --create-db --reuse-db --junitxml=/tmp/menu-location-acceptance-2026-11-15.xml`.

Frontend: `pnpm --filter @uog/admin-web test -- src/sites/menu-locations.test.tsx src/sites/site-menus.test.tsx`.

[Backend console](backend.txt), [frontend console](frontend.txt), [administrator/API policy](../../menu-locations.md), [original full review evidence](../menu-locations-2026-11-14/README.md).

External review approval, PR/CI release and attachment to a specific Azure DevOps Issue remain pending. No Issue identifier was supplied.
