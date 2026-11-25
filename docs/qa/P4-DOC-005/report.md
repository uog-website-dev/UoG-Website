# P4-DOC-005 verification

## Result

Implementation and API checks pass for the listed filtering, pagination, Site-isolation, and data-leakage behaviors. Full browser E2E is **not complete**. The current local Sites are not eligible for document publication because global `MEDIA` is disabled, and Edge failed to start its DevTools endpoint in this Windows environment.

## Acceptance criteria

| AC | Result | Evidence / limitation |
| --- | --- | --- |
| AC01 | **FAIL on current Main and Informatics Sites** | The page and host-scoped APIs are implemented. Runtime Site contexts for `www.uog.local` (Main) and `informatics.uog.local` (pilot) omit `DOCUMENTS`; global `MEDIA` is disabled, so the route correctly shows Documents unavailable. |
| AC02 | **PASS** | Public API search filters document titles; focused API tests pass. |
| AC03 | **PASS** | Matching and nonmatching title searches are tested. |
| AC04 | **PASS** | Category filter results are tested under the resolved Site hostname; a second Site returns no foreign records. |
| AC05 | **PASS** | File-type filtering, distinct page 1/page 2 results, and invalid page/page-size rejection are tested. |
| AC06 | **NOT VERIFIED** | Responsive grid breakpoints (3/2/1 columns) and keyboard-operable controls are implemented and typecheck. Browser viewport and keyboard E2E did not run because Edge exited before exposing its DevTools endpoint (`GPU process isn't usable`). |
| AC07 | **PASS in implementation/API behavior** | Empty API results are exercised for a second Site; the page has distinct no-documents and no-search-results states. |
| AC08 | **PASS in implementation** | `/documents` uses the shared public Site shell and Site theme context. The route returned HTTP 200. A visual browser check could not be completed. |
| AC09 | **PASS** | Invalid category syntax and invalid page/page-size parameters return validation responses. |
| AC10 | **PASS** | Public API response checks assert storage references, file references, and `site_id` are absent. The listing filters to ready, scanned assets. |

## Checks run

- `docker compose exec -T backend pytest apps/cms/tests/test_documents_api.py -q --reuse-db --tb=short` — **10 passed**.
- `docker compose exec -T frontend-public pnpm --filter @uog/public-web typecheck` — **passed**.
- `docker compose exec -T backend python manage.py check` — **no issues**.
- `docker compose exec -T backend python manage.py showmigrations cms` — `0042_document_access_settings` applied.
- `GET /documents` on `www.uog.local` — HTTP **200**.
- `git diff --check` — **passed**.

No Site module or content settings were changed for this run. The Main and Informatics Sites currently lack `MEDIA` assignments, and the global `MEDIA` capability is disabled. The route and responsive interactions still need a real-browser E2E run after an authorized platform operator enables the required module dependency and a browser automation runtime is available.
