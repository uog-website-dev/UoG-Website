# Category archive verification

This change adds a public category archive using the existing Post listing selector, pagination and responsive cards. The Main Site and child Sites share the same hostname-derived scope; no college-specific route or schema migration is introduced.

| Acceptance criterion | Evidence |
| --- | --- |
| AC-01 | Published category and Post selection scoped by resolved Host; backend archive fixture and real-browser cards |
| AC-02 | Equal timestamp fixtures across three pages, distinct taxonomy joins, browser next-page nonduplication |
| AC-03 | Foreign category lookup returns the same 404 as unknown |
| AC-04 | Unknown slug returns 404 from the documented API |
| AC-05 | Empty category returns count 0 and displays an intentional message plus All news link |
| AC-06 | Draft/future exclusion in archive regression and unpublished eligibility in shared news regression |
| AC-07 | Disabled POSTS rejects archives before category disclosure |
| AC-08 | Invalid size/page, duplicate parameters, foreign scope and redundant category filters return 400 |

Evidence: [backend tests](backend-tests.xml), [component tests](component-tests.xml), [browser checks](browser-results.json), [accessibility](accessibility.json), [desktop](desktop.png), [mobile](mobile.png), [TypeScript](typecheck.log), [production build](public-build.log) and [validation summary](validation.json).

The browser runs anonymous Edge against real Django/PostgreSQL and Next.js using the two existing news rehearsal hostnames. `scripts/qa-category-archives-seed.py` requires DEBUG and explicitly reuses those two Sites. It publishes five articles and eligible/empty/foreign categories through the existing role-separated workflow, also creating an unpublished category and private draft. Its three local fixture accounts are disabled in a finally block; it creates no Keycloak identities or credentials. [Fixture identifiers](fixtures.json) contain no secrets. `scripts/qa-category-archives-browser.cjs` uses Playwright Core and axe-core paths from `UOG_QA_PLAYWRIGHT_ROOT` and `UOG_QA_AXE_PATH`.

The existing card component regression checks that the approved category label links to its local archive. Backend public-feed fixtures now publish categories when they expect public taxonomy labels. Unpublished taxonomy remains available to authenticated authoring; it is no longer advertised from public news cards.

Manual keyboard evidence is limited to automated real-browser focus and Enter activation of pagination; independent human accessibility review remains pending. No migration or rollback is applicable. Independent approval, PR creation and Azure DevOps Issue attachment remain pending. [API and configuration guide](../../category-archives.md).

The real-browser rehearsal passed six checks with zero automated accessibility violations. The local Next.js development server needed a restart to refresh its route table after the new dynamic archive route was introduced; the production build independently includes that route. The initial cold-load attempts were not acceptance passes. The final browser result file records the successful run.

Final validation: 33 backend tests, 10 component tests and six real-browser checks passed. Workspace TypeScript, public production build, OpenAPI validation, Django system check and migration drift check passed. No schema migration is introduced. See [prepared PR description](PR.md).
