# Article media QA

The implementation connects the dedicated Post editor to the existing Site Media Library, upload workflow, image processing and delivery service. It stores canonical asset IDs and distinct revision placements. It serves the Main Site and eligible child Sites through shared code.

| Criterion | Evidence |
| --- | --- |
| AC-01 | API identity and object-count assertion, component featured selection, real browser picker and private image decode |
| AC-02 | Inline document round trip and two placements for one asset, browser reopen with image decode and alternative text |
| AC-03 | Foreign inline and featured IDs rejected atomically, existing ready-image picker isolation regression |
| AC-04 | Pending, processing, archived and document rejection, required alternative text, quarantine publication failure |
| AC-05 | API removal preserves the asset, browser removal retains the inline image using the same asset |
| AC-06 | Deletion guard, retained-revision protection, reference detach rejection, concurrent link/delete regression, renderer fallback |
| AC-07 | Direct media-use rejection and existing Post edit authorization regression |
| AC-08 | Direct MEDIA and POSTS gate tests, UI attachment controls hidden for disabled MEDIA, public eligibility checks |

[Backend and revision tests](backend-tests.xml), [deletion race and Media regression](race-tests.xml), [editor and picker component tests](component-tests.xml), [renderer tests](renderer-tests.xml), [real service API checks](live-api.json), [browser results](browser-results.json), [accessibility scan](accessibility.json) and [validation summary](validation.json) contain the results. The browser exercises real Keycloak, Django, PostgreSQL, Next.js and private image delivery. The API rehearsal uploads through MinIO and waits for a real Celery worker to produce derivatives before publishing through separate reviewer and publisher accounts.

Screenshots capture the [desktop editor](editor-media.png), [mobile editor](editor-media-mobile.png) and [published article](public-images.png). [Migration apply, rollback and reapply](migration-rehearsal.log), [admin build](admin-build.log), [public build](public-build.log), [TypeScript](typecheck.log), [fixture identities](fixtures.json) and [generated identity cleanup](cleanup.json) support the rehearsal.

Migration 0013 keeps existing immutable snapshots and canonical asset ownership. It extends the existing reference guard to Post revisions and indexes eligible historical featured uses. Ordinary article writes and revision restore validate image eligibility. Quarantined assets prevent publication. Unpublishing remains available when an image becomes unavailable. The existing retention policy protects image identities referenced by retained Post revisions.

The checkout also changed to dedicated full-page Post routes during implementation. Media controls and browser navigation use those routes. The browser retry corrected an assertion that counted images before client-side publication loading completed. The final browser result waits for images and decodes both published images.

Run `scripts/qa-post-editor-seed.py`, `scripts/qa-post-media-live.py`, `scripts/qa-post-media-browser.cjs` and `scripts/qa-post-editor-cleanup.py` with the local Compose stack. The Python helpers use `scripts/sprint3_live_review.py` and require DEBUG. Supply local Keycloak configuration through stdin. The temporary session file uses mode 0600, and the browser consumes it through stdin. Cleanup disables generated accounts and removes that file. Review Sites and content remain available as audit fixtures.

Independent approval, PR creation and Azure DevOps Issue association remain pending. [API and user guidance](../../post-media.md) and [OpenAPI](../../api/openapi.yaml) are prepared for review.

The final results contain 77 backend tests, 11 deletion and race tests with real MinIO enabled, 34 editor/picker tests, seven renderer tests, 15 real API checks and five browser checks. All passed. The mobile accessibility scan reported zero violations. Generated accounts were disabled and the temporary secret session file was removed. [Prepared PR description](PR.md)
