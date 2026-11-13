# Article workflow QA

The editor integrates the existing CMS transitions, reviewer comments and role-derived actions. A saved-revision preview opens through the authenticated session in a new tab. Post working copies preserve the original public article while a revised copy is edited, reviewed and promoted through the same workflow.

| Criterion | Evidence |
| --- | --- |
| AC-01 | API submit state and ETag checks, component confirmed-state test, browser Author submission |
| AC-02 | Required rejection comment, optional approval comment and author/reviewer separation tests, separate browser Reviewer session |
| AC-03 | Direct Author publication denial and permission-aware UI controls |
| AC-04 | Authorized preview, anonymous denial, Site isolation and new-tab browser preview while public output remains unchanged |
| AC-05 | Working-copy publication preserves original ID/slug, immutable earlier snapshot and public availability; browser publication and unpublication |
| AC-06 | Cross-Site review and publication rejection, independent Site publication check, scoped workspace read tests |
| AC-07 | Invalid-state and stale-ETag tests preserve state, component transition error retains form |
| AC-08 | Scheduling inputs rejected and scheduling controls absent |
| AC-09 | Disabled POSTS rejects preview, working-copy and transition endpoints |

[Backend tests](backend-tests.xml), [editor components](component-tests.xml), [migration rehearsal](migration-tests.xml), [real API negative checks](live-api.json), [real upload and initial publication](upload-api.json), [browser workflow](browser-results.json), [accessibility scan](accessibility.json) and [validation](validation.json) record results. Browser runs use real Keycloak sessions for Author, Reviewer and Publisher with Django, PostgreSQL and Next.js. The image fixture uses private MinIO and a real Celery worker. The independent Site has a separate hostname and publication.

Screenshots show [private preview](private-preview.png), [published revision](published-revision.png) and [mobile workflow](workflow-mobile.png). [Admin build](admin-build.log), [public build](public-build.log), [TypeScript](typecheck.log), [source manifest](source-manifest.json), [fixture identifiers](fixtures.json) and [generated account cleanup](cleanup.json) accompany the run.

The browser found a standard-role workspace gap. Reviewers and Publishers could call workflow APIs but lacked Site read permission for the administration shell. Migration 0008 and the role catalog now grant Site and media read permissions within the role's assigned Site. Tests verify those reads, denied foreign reads and the absence of Post update/media upload rights. The final browser run uses those standard roles.

The editor UI was refined concurrently in this checkout. The browser test follows its saved-in-place draft behavior and role-derived controls. Backend and component tests bind transitions to the current revision and preserve local values on errors. Working-copy promotion reuses the CMS publication lock and existing cache invalidation.

Run the existing article seed helper, `scripts/qa-post-media-live.py`, `scripts/qa-post-workflow-live.py`, `scripts/qa-post-workflow-browser.cjs` and the article cleanup helper in the local Compose environment. The Python helpers require DEBUG and configuration on stdin. Generated credentials stay in a mode-0600 container temporary file and reach the browser only through stdin. Cleanup disables generated accounts and removes the file. Fixture content remains available for audit.

Independent code approval, PR creation and Azure DevOps Issue attachment remain pending. [Workflow guide](../../post-workflow.md) and [OpenAPI](../../api/openapi.yaml) describe the contract for review.

The final results passed 83 backend regression tests, 27 editor component tests, seven renderer tests, one migration rehearsal and seven browser checks. Five focused working-copy tests were rerun after verifying that promotion copies the latest submitter, reviewer and review comment onto the original article. These five tests overlap the broader backend suite. The API rehearsal passed 17 negative/isolation checks and 15 upload/initial-publication checks. Both builds, TypeScript and OpenAPI validation passed. The final accessibility scan reported zero violations. Seven generated accounts were disabled and the temporary secret file was removed. [Final attribution regression](final-working-draft-tests.xml) and [prepared PR description](PR.md)
