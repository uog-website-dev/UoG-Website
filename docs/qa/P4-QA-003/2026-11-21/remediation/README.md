# P4-QA-003 ? Code blocker remediation

**The regression and automated accessibility blockers are fixed in the working tree. Release remains NO-GO pending external evidence, review and an immutable committed candidate.** The [original review](../README.md) and failing attempts are retained; this follow-up does not rewrite their results or invent human approval.

## Verified results

| Check | Final result | Evidence |
| --- | --- | --- |
| Full backend, including private MinIO tests | **1,185 passed, zero failures/errors/skips** | [JUnit](backend.xml), [log](backend.log) |
| Full frontend | **1,057 passed**: 672 admin tests executed fresh; 385 unchanged API-client/shared-UI tests were valid Turbo cache hits | [Full log](frontend.log) |
| WCAG 2.1 A/AA automated matrix | **32 passing viewport scans, zero violations** across Main and pilot public/authoring routes. Failed surfaces were rescanned after correction; unchanged passing surfaces were retained during resume. | [Results](accessibility.json), screenshots in this directory |
| Keyboard interaction | Workspace Enter/Escape with focus restoration; upload browsing via Enter and Space; cancelling chooser adds no upload | [Main](keyboard.json), [college](keyboard-college.json), [repeatable script](../../../../../scripts/qa-release-keyboard.cjs) |
| Workspace TypeScript | Passed | [Log](typecheck.log) |
| Admin and public production builds | Both passed in an isolated checkout | [Exit codes](build-results.json), [admin log](admin-build.log), [public log](public-build.log) |
| Release-policy / performance-harness tests | **13 release-policy and 11 Node harness tests passed** | [Policy log](gate-unit-tests.log), [harness log](perf-harness-tests.log) |
| Evidence hygiene | No generated credentials, environment secrets or JWTs found; temporary identities disabled and grants revoked | [Scan](secret-scan.json), [cleanup](cleanup.json) |

The API shape, database schema, role grants, publication workflow and public ownership boundaries were not broadened. No migration is required. Backend routing behavior remains unchanged: a platform hostname resolves Main public context only in development, while production and unknown-host isolation retain their existing guards. Existing API/OpenAPI contract evidence remains in the original packet; this patch changes UI semantics and regression expectations, not endpoints.

## Fixes

- **QA-REG-001:** Removed the institutional hostname example from a middleware comment so the data-driven foundation check no longer flags it. Updated the foundation regression to explicitly verify both the intended DEBUG-only Main fallback and production no-fallback behavior. Both conditions and the complete backend suite pass.
- **QA-REG-002:** The image-save regression now waits for the asynchronous preview instead of assuming it appears within the default one-second assertion window. The Builder history regression avoids repeated pointer-layout work in jsdom and now checks actual row identity/order after move, undo and redo, plus divergent-edit redo clearing. A clean full frontend run passes.
- **QA-A11Y-001:** Increased rich-text placeholder and disabled Page helper-text contrast using existing theme text tokens.
- **QA-A11Y-002:** Included the visible Site name in the workspace button's accessible name; aligned media details' accessible names with ?Edit details?; replaced the upload area's custom button role with a native button and separated help/format text via descriptions. Loading upload-policy skeletons now use a valid status role. Native upload Enter/Space handling and focus styles remain usable.
- Updated component tests and performance/browser selectors for the corrected accessible labels. The browser harness now waits for upload controls to be ready before scanning Media, covering the actual interactive state rather than a loading placeholder.

[Structured defect disposition](defect-disposition.json) and [summary](summary.json) record the closure scope. Automated accessibility passes are not a manual WCAG conformance certificate. Screen-reader review, manual focus/contrast checks and any agreed exceptions still need responsible reviewers.

## Rehearsals and cleanup

Earlier browser checks that still received the old development bundle and intermediate upload-label findings are preserved as `accessibility-before-*.json`. The development admin service was restarted to load corrected code. One frontend run was interrupted by a service restart and was superseded by the complete passing run linked above. No interrupted run is represented as green.

The full backend suite ran with `RUN_MEDIA_MINIO_TESTS=1`, using unique test-owned storage objects and cleanup. Matching architecture documents were present in the runtime so documentation contract checks also ran instead of skipping. Existing institutional content was not edited by the browser checks; file chooser tests cancelled selection and did not upload files. Both temporary browser-review identities were disabled, memberships revoked and the private journal removed. The admin development service remains available with the UI fixes loaded.

## Release blockers that cannot be self-approved

1. A QA **base URL**, approved representative workload/duration and completed **500-concurrent-user / p95 load under 1.5 s** evidence. The label ?QA? alone supplies neither an endpoint nor methodology. Local regression durations are not load measurements, and the old four-client benchmark is not 500-user proof.
2. Infrastructure-owned backup/restore, deployment rollback and operational evidence, supplied and reviewed by responsible teams.
3. Authoritative PR/code-review/Issue traceability, remaining story mapping/coverage evidence and external Issue attachment.
4. Human manual accessibility review and named Product Owner, QA, Security and infrastructure approval records.
5. Commit/review the remediation, run remote CI and re-evaluate the release gate on the final immutable candidate. The older PERF-010 gate/methodology reconciliation also remains open.

No signature, accepted risk, infrastructure result or load result was fabricated. Production readiness and deployment authorization remain **false**. The original gate continues to block release; these passing worktree checks close the code findings only.
