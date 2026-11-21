# Main university website workflow ? 21 November 2026



The real-service Main Site workflow passed AC01?AC07. AC08 and release approval remain pending external Issue/PR attachment and review. This is implementation acceptance evidence, not a prototype walkthrough or a claim that the university content/design is editorially approved.



Base commit: `a26ed8a` (full ID in [environment](environment.json)); application and harness changes are uncommitted, with [source hashes](source-hashes.json). Run `mainqa-8995d437` used Main Site `17`, code `MAIN`, active hostname `www.uog.local`. All editorial changes were made through admin UI controls. Setup created only disposable identities, Site memberships and module prerequisites; it did not seed Pages, Posts, menus or media rows.



## Acceptance evidence



| Criterion | Actual result | Evidence |

| --- | --- | --- |

| AC01 homepage template ? builder ? publication | PASS. Editor created a Page, previewed/applied University Main from Builder, edited its headline and saved. Separate Reviewer approved and Publisher published. Site Administrator assigned it as the Main root. | [Template catalogue](main-template-catalogue.png), [builder](homepage-builder.png), [desktop root](homepage-desktop.png), [workflow/approval inventory](database-inventory.json) |

| AC02 formatted news + featured image | PASS. UI-uploaded PNG reached READY through real MinIO/Celery. Bold paragraph and selected featured asset survived publication; the anonymous list/detail displayed the article and decoded image with alternative text. | [Upload](media-upload.png), [publication controls](article-publication-admin.png), [news list](news-list.png), [article detail](article-desktop.png) |

| AC03 right sidebar Page | PASS at 1440?1000 and 390?844. Existing structured-block editor saved body, RIGHT_SIDEBAR layout and reusable sidebar. Published output retained text and navigation. | [Page editor](right-sidebar-editor.png), [desktop](sidebar-desktop.png), [mobile](sidebar-mobile.png), [sidebar configuration](sidebar-management.png) |

| AC04 distinct navigation locations | PASS. Three distinct published same-Site menus were assigned to Primary Header, Footer and Page Sidebar. Each rendered its own label/link; typed news destinations resolve to `/posts`. | [Location controls](menu-locations.png), [public Page](sidebar-desktop.png), [assignment IDs](database-inventory.json) |

| AC05 anonymous draft denial | PASS before article publication. A fresh anonymous browser did not receive the saved draft paragraph. Later private homepage edits also remained absent until approval/publication. | [Browser checks](progress.json), [unchanged public homepage while draft differs](homepage-before-promotion.png), [HTTP route/status trace](django-http-trace.json) |

| AC06 unauthorized role denial | PASS. Site Viewer direct editor route showed permission denial and no Create Page action. Direct forged create API returned 403. No forbidden Page persisted. Editor access to administrator-only Homepage Settings was also correctly denied; Editor used the permitted Pages/Builder entry point instead. | [Viewer denial](viewer-denied.png), [403 result](progress.json), [canonical Site grants](database-inventory.json), [backend authorization tests](backend-tests.xml) |

| AC07 restore older homepage revision | PASS. Published a reviewed headline update, unpublished to verify safe root fallback, then restored original revision **5** as a new draft and repeated Editor?Reviewer?Publisher handoff. Anonymous root returned the original headline. | [Original revision](homepage-original-revisions.png), [private edit](homepage-private-update.png), [published update](homepage-updated.png), [safe fallback](homepage-safe-fallback.png), [restore control](homepage-revision-restore.png), [restored root](homepage-restored.png) |

| AC08 Issue-linked acceptance package | PENDING. Repository artifacts are ready; no Azure DevOps Issue URL or PR was supplied. No external attachment, review or sign-off is claimed. | This report and linked artifacts |



## Environment and verification



Real Docker Compose Django/PostgreSQL, Keycloak, Redis, private MinIO, Celery, Next.js admin/public and nginx were used. Roles were separate canonical Site-only memberships: Site Administrator, Editor, Reviewer, Publisher and Viewer. No platform or organization grant was added. [Environment/service health](environment.json) and [database/migration inventory](database-inventory.json) record actual configuration. Main already had an active primary development hostname. The browser mapped `*.uog.local` to loopback; ordinary browsers need local DNS/hosts resolution for `www.uog.local`.



The browser workflow used development Next.js services and real authentication. Optimized production builds were verified separately; this report does **not** claim that the end-to-end walkthrough ran against production servers. [Final build results](final-builds.json): admin build exit 0 in 72.96 s, public build exit 0 ([log](public-build.txt)); admin and public TypeScript checks passed ([log](typecheck-final.txt)). The earlier [admin build log](admin-build.txt) is a successful pre-fix rehearsal, not the final build transcript. Final admin build completion metadata is in `final-builds.json`.



Focused automated results (overlapping reruns are not additive):



- **61 backend tests passed**, no skips/failures: homepage templates/assignment, sidebar widgets, menu locations and canonical membership authorization. [JUnit](backend-tests.xml), [console](backend-tests.txt).

- **32 admin component tests passed**: menu editor/items, homepage controls and Post workflow. [JUnit](ui-tests.xml), [console](ui-tests.txt).

- **25 final root/menu tests passed**, including four new public-root cases: published-only/foreign rejection, disabled Pages, stale-Site abort and recoverable failure, plus menu save/publication race coverage. [JUnit](root-tests.xml), [console](root-tests.txt).

- **11 shared public Page tests passed** after the mobile hidden-heading fix. [JUnit](public-page-tests.xml).

- Main browser positive/negative and restoration stages passed, followed by another anonymous desktop/mobile check **after account cleanup**. [Progress](progress.json), [mobile dimensions](mobile-layout.json): width 390, document width 390, no overflowing elements.



[Browser traces](api-trace.json) and [Django traces](django-http-trace.json) retain only method, path, status and available request IDs. They include rehearsal attempts and expected denials/conflicts; they are not an all-2xx success metric. Request query values, cookies, credentials, tokens and response bodies are excluded. [Secret scan](evidence-scan.json) found no environment secrets, generated passwords/access tokens or JWTs in evidence.



Concurrent hostname-resolution code, tests and documentation edits appeared during final collection and were preserved. Their separate focused resolution/homepage regression run passed **17 tests** ([JUnit](resolution-regression.xml), [console](resolution-regression.txt)); the final anonymous hostname walkthrough was rerun and passed. This does not attribute those edits to this task.

No model/API schema changed in this task. Existing migration leaves were all applied; no new migration or destructive database rollback was needed. Application-level rollback was exercised through revision restore and republish. OpenAPI contract changes are not applicable; existing endpoint contracts are used unchanged.



## Defects and disposition



| Local defect | Disposition / regression |

| --- | --- |

| MAIN-QA-01 ? Publish immediately after menu item save could use the preceding ETag and return 409 | FIXED. Parent menu actions remain disabled during item writes, refreshing and until the new menu version is visible. Existing server conflict protection is retained. Deferred-write component regression verifies publication uses the refreshed ETag. Subsequent real menu edits/publications passed. |

| MAIN-QA-02 ? Public homepage always displayed prototype routing/health diagnostics | FIXED. Root now uses the shared published Page renderer and host-resolved homepage API, with loading, retry and safe fallback. No Main-specific ID or content branch was added. Published-only, disabled-module, foreign-Site and stale-response regressions passed. |

| MAIN-QA-03 ? Mobile root overflowed 390 px viewport by 8 px | FIXED. Anchored the existing visually hidden title at left/top, retaining accessible heading semantics. Browser width changed from 398 to 390 px. Shared renderer tests passed. |

| Rehearsal harness selectors and timing | CORRECTED. MUI names, Submit-for-review label, menu re-selection after reload and detail-loading waits were aligned with actual UI. Duplicate rehearsal menu links were removed through UI. The initial root-test expectation incorrectly assumed `credentials: omit`; corrected to the existing safe fetch helper contract, retaining no Authorization header. [Initial failed test evidence](root-tests-initial.xml) is preserved. |

| Development first-visit gateway 502 | RECOVERED. Bounded navigation retries were recorded in `progress.json`. Final stages completed; production compilation passed separately. No unconditional suppression of application assertions was added. |

| PERF-010 cached-return timing failures | STILL OPEN, outside this functional story. [Previous release evidence](../P0-PERF-010/2026-11-20/README.md) remains authoritative. This walkthrough does not clear that release blocker. |



## Retained state and handoff



The Main Site remains ACTIVE with the restored original approved QA homepage assigned. Initial homepage assignment was empty. The article, right-sidebar Page, reusable sidebar, three menus and approved media remain for inspection. Template starter copy/logo placeholders are intentionally visible; this verifies authoring/publication, not a finished institutional design. No existing Main content or unrelated Site was deleted or archived. An archived working draft in the inventory is the normal promotion result.



All five review identities were disabled in Keycloak and Django, their five memberships revoked, and the private credential journal removed. [Cleanup outcome](cleanup.json). One identity created during an early failed setup was separately disabled before the accepted run. Production credentials and existing staff accounts were not changed. Normal development services remain available.



Pending: external code review, QA/Product/Security sign-off as applicable, immutable release-commit rerun/production deployment verification, and Issue/PR attachments. AC08 and the full Definition of Done remain open until those steps are completed. [Repeatable runbook](RUNBOOK.md).

