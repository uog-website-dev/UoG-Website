# P4-F-POST formatted article editor QA

Date: 2026-11-13. Scope: existing Site-owned Posts, draft revisions, rich article editing and existing public Post delivery. Tests use disposable review data; the original seven Posts remain in their legacy format. This is implementation evidence, not a signed product acceptance or a prototype walkthrough.

## Evidence

| Acceptance criterion | Evidence |
| --- | --- |
| AC-01: formatted draft creates and reopens | `test_versioned_article_round_trip_revisions_and_conflict`; browser formatted save/reopen and toolbar checks |
| AC-02: another editor saves a revision; history recovers | API test restores the original document as a new revision; browser uses separate real author/editor sessions |
| AC-03: missing title / invalid document does not persist | Parameterized invalid version, boolean version, empty, oversized, too deep, excessive elements, extra property, null and invalid Unicode; atomic invalid-update test checks unchanged data and revision count |
| AC-04: scripts/events cannot execute | API sanitization test, shared renderer hostile-text/link tests, safe browser paste and public rendering |
| AC-05: direct unauthorized writes denied | Backend role tests; real unauthenticated and authenticated viewer HTTP calls return 401/403 |
| AC-06: Site isolation | Backend two-Site cases; real foreign-ID GET/PATCH return 404 and foreign Site route returns 403; foreign content unchanged |
| AC-07: POSTS gate | Hidden/disabled UI actions; real disabled write returns the existing 400 module error; re-enable recovers |
| AC-08: explicit stale save conflict | Transaction/ETag API regression and real two-session conflict; stale text is retained |
| AC-09: failed save preserves text and retries | Component error/retry tests and browser-aborted server-action request followed by successful retry/reopen |

- [Backend/API and revision JUnit](backend-tests.xml): 29 tests passing, using PostgreSQL with `--create-db` to apply the full migration graph.
- [Admin regression JUnit](admin-tests.xml): 505 tests passing.
- [Complete shared UI JUnit](ui-tests.xml): 184 tests passing with two workers.
- [Final editor regression JUnit](final-post-editor-tests.xml): 13 tests, including explicitly reapplying Paragraph when that menu value is already selected.
- [Focused admin JUnit](admin-focused-tests.xml): Post editing plus corrected existing navigation test expectations.
- [Real API rehearsal](live-api.json): 18 checks passing, with real Keycloak bearer tokens, Nginx, Django and PostgreSQL. Includes author/reviewer/publisher handoff on the existing workflow and anonymous delivery of the approved document.
- [Real Edge workflow](browser-results.json): Keycloak login, authoring, reopen, two-editor conflict, discard warning, interrupted save/retry, toolbar controls, mobile keyboard access and anonymous public rendering. Browser version and generated Site ID are recorded there.
- [Accessibility scan](accessibility.json): no WCAG 2 A/AA or 2.1 A/AA violations in the mobile editor dialog. Browser keyboard checks also focus the writing area, invokes the link dialog from the keyboard, closes it with Escape and checks discard confirmation. This is scoped evidence, not a claim of exhaustive assistive-technology certification.
- [Desktop editor](desktop-editor.png), [mobile editor](mobile-editor.png), [mobile public article](public-article-mobile.png).
- [Admin production build](admin-build.log), [public production build](public-build.log), [validation](validation.json), [source manifest](source.json), [migration rehearsal](migration-rehearsal.txt), [legacy inventory](inventory.json), [generated-user cleanup](cleanup.json).
- [API schema and request example](../../api/openapi.yaml), [author/configuration and compatibility guide](../../post-editor.md).

## Compatibility and defect disposition

The pre-change inventory contains seven legacy Posts: four with paragraph blocks and three with body-only content. Existing identity, Site ownership, revision storage, workflow and public routes are reused. Editor version 1 is stored in existing metadata, with sanitized HTML in content. No article schema/data migration or bulk conversion was introduced. Unsupported legacy structured blocks remain in the older block editing mode to avoid losing media/layout data.

The clean database run initially found two pre-existing Sites migration leaves. `sites.0011_merge_homepage_module_deactivation` joins them without operations; it applied, rolled back and reapplied successfully. The new versioned article also passes the existing revision restore and publish-lock rules.

A real-browser test found that opening the link dialog could lose the article selection. The editor now retains an explicit selection, avoids replacing native edits on React rerenders, and applies the link after the dialog releases focus. A regression also covers applying Paragraph when the menu already displays that value for heading content. Each style menu item now applies its formatting command explicitly. The final visual check also found flex shrinking clipping the writing area; the editor now retains its height and the parent dialog scrolls.

The initial broad regression results are retained in [admin-full-initial.xml](admin-full-initial.xml) and [ui-full-initial.xml](ui-full-initial.xml). Four pre-existing admin expectations were stale: public-link accessible labels and a Builder-navigation fixture missing the required VISUAL_BUILDER enablement. Those test expectations now match the existing behavior; production navigation was not changed. One shared widget test timed out during the initial high-concurrency run; the complete shared suite passed with two workers and unchanged assertions/timeouts. The shared test configuration now bounds jsdom workers to two, matching the existing admin test policy.

The Docker Desktop development watcher retained stale frontend modules during this run. Both frontend services were restarted before the final browser pass. Production builds use isolated source copies and do not overwrite the running development `.next` directory.

## Repeatability

Run backend tests inside the existing Compose backend:

```powershell
docker compose exec -T backend pytest apps/cms/tests/test_posts_api.py apps/cms/tests/test_public_posts.py apps/cms/tests/test_revisions.py -q --create-db --junitxml=/tmp/post-editor-tests.xml
docker compose exec -T backend python manage.py spectacular --file /tmp/post-editor-openapi.yaml --validate --fail-on-warn
docker compose exec -T frontend-admin pnpm typecheck
docker compose exec -T frontend-admin pnpm --filter @uog/admin-web exec vitest run
docker compose exec -T frontend-admin pnpm --filter @uog/ui exec vitest run --maxWorkers=2
```

The live rehearsal scripts are local-only (`DEBUG` required): `scripts/qa-post-editor-seed.py`, `scripts/qa-post-editor-live-api.py`, `scripts/qa-post-editor-browser.cjs` and `scripts/qa-post-editor-cleanup.py`. The Python scripts reuse `scripts/sprint3_live_review.py`; copy these helpers into the backend container's `/tmp` first. Supply local Keycloak configuration on stdin, never in arguments, logs or committed files. The seed writes generated credentials only to a mode-0600 container `/tmp/post-editor-browser-session.json`. The live API step adds an independent Site, permission profiles and a published article. Pass that private session to the browser script on stdin. It requires Playwright Core, an Edge executable and axe-core; `UOG_QA_PLAYWRIGHT_ROOT` / `UOG_QA_AXE_PATH` identify local installations. Finish with the cleanup helper to disable only generated identities and remove the secret file. Generated QA Sites/content are retained for audit evidence.

## Remaining release administration

Independent code review/approval, PR creation/merge and Azure DevOps Issue association are pending. No Issue URL/ID was supplied and no approval has been invented. The implementation and QA artifacts are ready to attach; [suggested PR description](PR.md) and [unsigned release checklist](review-checklist.json) accompany this evidence.

## Current acceptance recheck

The current Post settings and rich-text component suite passed 19 tests after the metadata changes. It covers formatting, safe preview, permissions, disabled modules, failed-save retention and stale-revision recovery. The latest clean-database API and revision regression passed 66 tests. The recorded real-browser article workflow remains available above. This recheck updated the repeatable browser script for the current permalink label and conflict guidance. It did not repeat that browser run. [Current editor results](current-editor-tests.xml) and [latest backend results](../post-metadata-2026-11-13/backend-tests.xml)

For this story, AC-08 concerns explicit stale-save conflicts and retained editor text. Its coverage is recorded above. The separate metadata story publication-visibility decision remains in its own QA record.
