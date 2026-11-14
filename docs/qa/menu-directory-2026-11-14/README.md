# Named Site menu directory — QA evidence

Date: 14 November 2026. Base commit: `09a186b44986da48a692a1b8fe0fd801be796f7e` plus this working-tree change. Local Docker Compose environment: PostgreSQL, real Keycloak, Django API, Next.js admin/public, Nginx. No production deployment or Issue attachment was performed.

## Results

- [Backend JUnit](backend-tests.xml): 75 passed, zero skipped/failures. Includes the new directory integration suite and existing Menu API, integrity, delivery and model regressions. New cases cover two named menus, UUID/code/item preservation on rename, duplicate identifiers, equivalent identifiers in different Sites, foreign read/write rejection, immutable code enforcement via raw ORM update, retirement, public header stability, unauthorized calls and disabled MENUS.
- [Full frontend workspace regression](frontend-workspace.log): all three workspace test tasks passed (two unchanged packages served from Turbo cache).
- [Component JUnit](admin-tests.xml): 19 passed. Directory creation/selection/search, empty/error/disabled/central states, item controls and delayed selected-menu response isolation.
- [Migration rehearsal](migration-rehearsal.json): forward/backward baseline rehearsal preserved seven menus and eight items, including IDs, assignments, versions and timestamps. A new unassigned menu blocked downgrade before destructive schema reversal. Script: [qa-menu-directory-migrations.py](../../../scripts/qa-menu-directory-migrations.py). This rehearsal runs against a development baseline; new unassigned menus must be reconciled before rerunning it.
- [Browser results](browser-results.json): five passing real-Keycloak checks. Site Administrator created two unassigned menus alongside existing header navigation, renamed with unchanged identifier, published/retired, searched and used keyboard controls at 390px. Viewports: 1440×1000 and 390×900. [Desktop](directory-desktop.png), [phone](directory-mobile.png). Browser script: [qa-menu-directory-browser.cjs](../../../scripts/qa-menu-directory-browser.cjs).
- Admin and public isolated production builds pass: [admin](admin-build.log), [public](public-build.log). Workspace TypeScript passes: [typecheck](typecheck.log).
- OpenAPI generation with `--validate --fail-on-warn` passes; committed [baseline](../../api/openapi.yaml) regenerated. `makemigrations --check --dry-run`: no changes. Django system check: no issues.
- [Generated identity cleanup](cleanup.json): Keycloak identity disabled, membership revoked, local identity disabled and private credential/session file removed. Review Site content retained as audited evidence. Passwords/tokens are excluded from these artifacts.

## Reproduction

Backend: `pytest apps/cms/tests/test_menu_directory.py apps/cms/tests/test_menu_api.py apps/cms/tests/test_menu_integrity.py apps/cms/tests/test_menu_delivery.py apps/cms/tests/test_menus.py -q --create-db --reuse-db --junitxml=/tmp/menu-directory-backend.xml`.

Frontend: `pnpm --filter @uog/admin-web test -- src/sites/site-menus.test.tsx src/sites/menu-items.test.tsx`. Browser fixture provisioning and cleanup use the shared development-only Review helper, with private configuration supplied on stdin; run only in the local review environment. Schema rehearsal requires the migration database role. See [administrator and rollback guidance](../../menu-directory.md).

Initial failures were resolved: the inventory test expected the old location ordering and now asserts documented name/UUID ordering; a reused test database lacked seeded modules, so final validation used a clean test database. The first browser attempt encountered a dev-server restart gateway error; rerun after readiness passed. The rename component test now waits for the metadata refresh before opening editing controls. These are recorded separately from the successful final runs.

## Remaining release steps

External code review/approval, CI execution, PR creation and linking these artifacts to the Azure DevOps Issue remain with the release workflow. No Issue identifier was supplied. Browser checks cover the principal desktop/mobile and keyboard flow; they are not a claim of complete assistive-technology certification.

## Local deployment follow-up

Migration 0025 confirmed applied with no pending migrations. Rebuilt backend/frontend images and recreated Django, Celery worker/beat and both Next.js services using the development Compose stack; reloaded Nginx. Django system check passed; `/health/ready`, `/admin` and `/` returned HTTP 200 after warmup. See [image build](deployment-build.log) and [service status](deployment-services.json). This was local deployment, not a remote production release. External review and Issue attachment remain pending a reviewer and a specific PR/Issue destination.
