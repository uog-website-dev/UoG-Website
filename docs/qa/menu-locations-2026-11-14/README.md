# Template menu locations - QA evidence

Date: 14 November 2026. Local Docker Compose release validation for P4-F-MENU location assignment. Code remains in the working tree; external approval and Azure DevOps Issue attachment are release steps, not claimed here.

## Results

- [Backend integration](backend-tests.xml): **68 passed**, one documentation-only test skipped because the runtime container omits checkout docs. [Separate documentation check](docs-check.xml) supplies that file and passes the skipped check. Coverage includes API permissions, scoped published destinations, template configuration regressions, unsupported/foreign IDs, guarded raw writes, replacement/unassignment, stale versions, and a real two-thread assignment race with one winner and one conflict.
- [Administration components](admin-tests.xml): **18 passed**, covering replacement confirmation, separate Save/Publish, unassignment, permission hiding, Site-switch isolation, recoverable conflicts/field errors, and existing directory behavior.
- [Public components](public-components.xml): **36 passed**, including independent utility navigation, explicit reusable sidebar precedence, template Sidebar fallback, explicit-empty Sidebar handling and responsive Page layouts.
- [Migration rehearsal](migration-rehearsal.json): forward/backward `cms0026/sites0011` to `cms0027/sites0012` preserved all 15 baseline menus and 22 items, including identifiers, versions, timestamps and assignments. Downgrade with a mapping probe was blocked; the probe was transactionally rolled back, not deleted.
- [Real-browser workflow](browser-results.json): six passing checks with a real Keycloak Site Administrator and two Sites. A saved replacement stayed private; publication changed Primary Header; Footer/Utility/Sidebar published independently; Site B stayed unchanged; phone controls fit; all four slots rendered on a public Left Sidebar Page; publishing unassignment removed only Header and retained the menu.
- [Accessibility scan](accessibility.json): zero WCAG 2 A/AA and WCAG 2.1 AA violations on the phone-width administration screen, with 27 passing axe rules. Keyboard checks exercise the public Sidebar. This is not a claim of complete assistive-technology certification.
- Production builds for admin and public passed. Workspace TypeScript, Django system checks, migration drift check and OpenAPI validation with `--fail-on-warn` passed. The [OpenAPI baseline](../../api/openapi.yaml) is regenerated. Console evidence: [backend](backend-tests.txt), [admin](frontend-tests.txt), [public components](public-components.txt), [TypeScript](typecheck.txt), [admin build](admin-build.txt), [public build](public-build.txt).

Screenshots: [assignment desktop](locations-desktop.png), [assignment phone](locations-mobile.png), [public desktop](public-desktop.png), [public phone](public-mobile.png). Viewports were 1440x1000 and 390x1000.

## Environment and reproduction

WordPress initially occupied ports 80 and 8080, so the integrated walkthrough used UoG ingress 8088 and Keycloak 8081 with a temporary local Compose override and an exact loopback callback. WordPress was not stopped by the agent. After the user stopped WordPress, UoG was restored to standard ports 80/8080. The Nginx relative-redirect correction prevents slash redirects from discarding a published host port; `nginx -t` passes.

Run backend tests with `--create-db --reuse-db`: `pytest apps/cms/tests/test_menu_locations.py apps/cms/tests/test_menu_delivery.py apps/cms/tests/test_menu_api.py apps/cms/tests/test_menu_destinations.py apps/cms/tests/test_module.py apps/sites/tests/test_site_template.py apps/sites/tests/test_configuration.py -q`. The transaction race can flush seed rows, so do not assume a previously reused database retains migration seeds.

Admin: `pnpm --filter @uog/admin-web test -- src/sites/menu-locations.test.tsx src/sites/site-menus.test.tsx`. Shared UI: `pnpm --filter @uog/ui test -- src/site-navigation.test.tsx src/reusable-sidebar.test.tsx src/public-page.test.tsx src/responsive-layout.test.tsx`.

Repeatable scripts: [migration rehearsal](../../../scripts/qa-menu-locations-migrations.py), [private fixture seed](../../../scripts/qa-menu-locations-seed.py), [integrated browser](../../../scripts/qa-menu-locations-browser.cjs), [standard-port verification](../../../scripts/qa-menu-locations-standard-ports.cjs), [cleanup](../../../scripts/qa-menu-locations-cleanup.py). Credentials are supplied on stdin and held only in a private temporary session; do not commit it. The integrated script records the alternate-port rehearsal, while the standard-port script verifies the restored runtime. Schema rehearsals are development-only and must run before adding new mappings.

## Acceptance mapping

| AC | Evidence |
| --- | --- |
| 1 | API promotion and browser Primary Header replacement/public rendering |
| 2 | Independent Footer/Sidebar API writes and four-slot public Page walkthrough |
| 3 | Restricted-template/unknown-slot tests and database guards |
| 4 | Explicit replacement tests, unique Site/location key and two-writer conflict |
| 5 | Forged foreign Menu API input and raw ownership rejection |
| 6 | Published null tombstone tests/browser, retained Menu IDs/items |
| 7 | Draft replacement and unpublished target rejection preserve existing public output |
| 8 | Foreign Site paths and denied Editor/Viewer publication or writes |
| 9 | Legacy fallback without mappings and existing menu delivery regressions |

[Administrator/API/rollback policy](../../menu-locations.md). Review approval, PR/CI release and linking artifacts to a specific Azure DevOps Issue remain pending; no Issue identifier was supplied.

## Standard runtime restored

[Standard-port login verification](standard-ports.json) passes at `http://localhost/admin/`, with Keycloak issuer `http://localhost:8080/realms/uog`. [Service status](runtime-services.json) records the restored healthy stack. Issuer-bound identity linking remained enforced during the port change, so a fresh review principal was used to verify standard-port access. [Cleanup](cleanup.json) disabled both generated Keycloak accounts, revoked their memberships, disabled local identities and removed the private session. The temporary 8088 callback/origin and Compose override were removed. Existing institutional users were not relinked.

[15 November acceptance coverage follow-up](../menu-locations-2026-11-15/README.md).
