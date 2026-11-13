# Public news QA

The public news page uses responsive cards and the existing host-resolved Post routes. A shared selector now drives article eligibility and latest-publication ordering for list, detail and widget consumers.

| Criterion | Evidence |
| --- | --- |
| AC-01 | Two-Site API isolation, Main property/child contract test, browser independent catalogs |
| AC-02 | Card link component assertion and same-host browser navigation to approved detail |
| AC-03 | Real MinIO/Celery thumbnail, component image error and browser missing-media fallback |
| AC-04 | Draft, future and unpublished exclusion, summary field assertions and future-detail rejection |
| AC-05 | Equal-timestamp fixtures across three API pages, identical widget order, browser page boundary |
| AC-06 | Default 20, maximum 100 and invalid/excessive field errors, browser first-page recovery |
| AC-07 | Empty Site API shape and browser empty state |
| AC-08 | Disabled module API rejection and browser unavailable state with hidden content |
| AC-09 | Unknown Site override parameters rejected and host-specific browser catalogs |

[Backend and widget regression](backend-tests.xml), [shared card components](component-tests.xml), [real API checks](live-api.json), [browser results](browser-results.json), [accessibility scan](accessibility.json) and [validation](validation.json) record outcomes. The browser uses anonymous Edge sessions on separate hostnames, real Django/PostgreSQL and Next.js. Its thumbnail fixture is uploaded through the existing MinIO and Celery flow. Controlled browser transport failures exercise retry, missing-image fallback and cancellation of an earlier request.

Screenshots show [desktop](news-desktop.png), [tablet](news-tablet.png) and [mobile](news-mobile.png). [Public build](public-build.log), [admin build](admin-build.log), [TypeScript](typecheck.log), [fixture identifiers](fixtures.json), [source manifest](source-manifest.json) and [identity cleanup](cleanup.json) accompany the run.

The fixture has 23 eligible child-Site articles, including 22 with an equal publication timestamp, plus draft and future-ineligible records. A separate university-owned Site has an independent article. Empty and disabled Sites exercise distinct frontend states. Bulk fixture publication uses the normal domain transitions with a fixed fixture clock. The media fixture uses real HTTP upload and role-separated initial publication. API tests also mark a Main property explicitly and verify the same contract against a child Site.

The listing uses the latest immutable snapshot timestamp for ordering. Regression covers working-copy promotion, ensuring a revised article moves ahead of an older publication while retaining its original public route. The snapshot serializer fetches one latest snapshot per article. The existing snapshot index supports that lookup. No schema migration is introduced.

The browser retry test found that native transport error text needed a public-facing message. Network and JSON failures now produce a recoverable news-unavailable state. The delayed-filter test waits for the first request to begin before changing filters, then verifies its cancellation cannot replace the active empty result.

The scripts `qa-post-editor-seed.py`, `qa-post-media-live.py`, `qa-public-news-live.py`, `qa-public-news-browser.cjs` and `qa-post-editor-cleanup.py` reproduce the local rehearsal. Python helpers require DEBUG and configuration on stdin. Generated credentials use the mode-0600 temporary session file and are passed to the browser through stdin. Cleanup disables generated accounts and removes the file. Audit fixtures remain on the generated Sites.

Independent code approval, PR creation and Azure DevOps Issue attachment remain pending. [Listing guide](../../public-news.md) and [OpenAPI](../../api/openapi.yaml) provide the review contract.

Final results: 29 backend tests, 10 component tests, 19 live API checks and 8 real-browser checks passed. Automated accessibility scans reported zero violations at the tested widths. Workspace TypeScript and both production builds passed. OpenAPI validation passed with warnings treated as errors. Seven generated accounts were disabled and the temporary secret file was removed. See [prepared PR description](PR.md).
