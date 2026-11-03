# QA-D005 fresh regression run — 3 Nov 2026

These counts replace the earlier 627/32/13 figures. No credentials are recorded.

Backend, `docker compose exec backend`, docs copied to `/docs` so the contract tests could read them. `pytest --tb=line -q`, exit 0, 511.955s.

- 643 passed, 0 failed, 0 errors, 0 skipped.
- `test_documented_block_contract_matches_the_domain` ran.
- `test_documented_strategy_matches_the_migration` ran.
- `test_cms_mounts_scoped_workflow_revision_admin_and_public_routes` passed.
- `content-workflow-history` remains in the expected route inventory.
- JUnit: `backend-junit-2026-11-03.xml`.
- Skip decision: the two documentation tests skip only when the docs files are not in the image. This run had the files and did not skip. No security test was removed, weakened, or marked skipped.

Frontend, `docker compose exec frontend-admin`, `pnpm test`, exit 0, 1m46s.

- `@uog/admin-web`: 40 files, 304 passed, 0 failed. Duration 103.52s. The Admin result was a cache miss and executed.
- `@uog/ui` and `@uog/api-client` were then forced (`--force`), cache bypass: UI 12 files, 86 passed; API client 7 files, 157 passed. Both started 03:46:30 UTC.
- Auth.js negative tests log MissingCSRF and InvalidCheck on stderr. Those tests passed. There were no unhandled test errors.

Typecheck, `pnpm exec turbo run typecheck --force`, exit 0, 18.64s. Five successful packages: admin-web, public-web, ui, api-client, types.

Production build, `node scripts/isolated-production-build.mjs`, exit 0, 4m6s. Source was copied to `/tmp/uog-frontend-build` with `.next` excluded and dependencies symlinked. Turbo build: 2 successful, 0 cached. Isolated admin and public `.next` directories were present. The development servers' `.next` directories were not the build output.

Browser, `http://localhost/admin/sites/2`, signed-in development user. Informatics Site rendered local Footer and Header from the API. The inheritance list was empty and the screen said there is no inheritance policy. It did not throw. Pages for that Site reported an empty list. Screenshots: `regression-site-menus.png`, `regression-site-navigation.png`.

CI: GitHub Actions workflow `.github/workflows/regression.yml` runs the backend suite, OpenAPI validation, frontend tests, typecheck and production build on pull requests. Azure pipeline PR builds are enabled for main, and image push stays on a main branch build.
