# Pilot college website workflow ? 21 November 2026





The Agriculture and Environmental Sciences pilot uses the shared CMS at **caes.uog.local**, Site **19 / CAES**. Main remains **17 / www.uog.local**. Editorial content was created through admin UI controls, not direct database writes or prototype payloads. This report is implementation evidence; external Issue/PR attachment, human review and release approval remain pending.





## Acceptance matrix





| Criterion | Result and evidence |


| --- | --- |


| AC01 college homepage publication | PASS. An Editor applied **College/Department**, edited/saved the builder tree, a distinct Reviewer approved, and college Site Administrator **255** published and assigned the homepage. [Catalogue](main-template-catalogue.png), [builder](homepage-builder.png), [published root](homepage-desktop.png), [workflow actors and same-Site assignment](inventory.json). |


| AC02 college news and Page routes | PASS. The formatted article with uploaded READY featured image renders at `/posts/collegeqa-b5e2f44c-news`; the right-sidebar Page renders at `/collegeqa-b5e2f44c-information` on the college hostname. [News list](news-list.png), [article](article-desktop.png), [sidebar desktop](sidebar-desktop.png), [sidebar phone](sidebar-mobile.png). |


| AC03 independent menus | PASS. Three different college-owned published menus occupy header, footer and sidebar slots. [Assignment UI](menu-locations.png), [public Page](sidebar-desktop.png), [assignment IDs](inventory.json). Main menus are unchanged. |


| AC04 college-only dynamic news | PASS. College homepage contains the college article and excludes Main's article; the normal public list returns only Site 19 records. A forged `?site=17` is rejected with 400 rather than overriding hostname scope. [Dynamic homepage](college-dynamic-news.png), [public isolation assertions](public-isolation.json). |


| AC05 no college-only Main mutations | PASS. **40 live HTTP cases** cover both directions of foreign reads/writes, foreign IDs in local resource paths, homepage assignment, forged asset/menu/sidebar references, module disable/re-enable and unknown hosts. Foreign mutation paths return 403/404. Field-addressed foreign-reference creates return 400 with no partial rows. College admin has only Site 19; reverse tests use a separate temporary Main-only identity. [Matrix and request IDs](isolation.json), [Viewer UI denial](viewer-denied.png), [fresh Viewer API 403](progress.json). |


| AC06 Main appearance/configuration unchanged | PASS. **27** Main content/configuration model hashes and **five** anonymous public API response hashes match before/after. Main visible text and links also match. [Before](main-before.json), [after](main-after.json), [browser baseline](main-browser-before.json), [Main before screenshot](main-before.png), [Main after screenshot](main-after.png). Audit events and explicitly created temporary IAM fixtures are excluded from content/configuration hashes. |


| AC07 unknown hostname | PASS. Unknown `*.uog.local` domain returns 404 from Site context and displays neither Main nor college homepage content. [Unknown-host screenshot](unknown-host.png), [HTTP matrix](isolation.json), [anonymous browser checks](public-isolation.json). |


| AC08 Issue attachment/onboarding handoff | PENDING external attachment and approval. [Onboarding and repeatable harness instructions](ONBOARDING.md) are ready. No Issue URL or PR was supplied, so no external attachment or sign-off is claimed. |





## Environment, provenance and results





Run **collegeqa-b5e2f44c** used the existing active college Site and primary domain, initially without a homepage. It already had PAGES, POSTS, MENUS and VISUAL_BUILDER. MEDIA was enabled through the canonical dependency-aware service. Disposable Keycloak accounts and database-backed Site memberships were fixture prerequisites. Domain/Site creation and identity/module setup were **not operated through their provisioning UI in this run**; all media/menu/sidebar/Post/Page/builder/publication/homepage content actions were performed through the real admin UI. The reusable onboarding procedure documents the supported administrative configuration flows for additional Sites.





[Environment](environment.json): real Django/PostgreSQL, Keycloak, private MinIO, Celery/Redis, nginx and development Next.js services. Browser: headless Edge via Playwright, 1440?1000 desktop and 390?844 phone, local `*.uog.local` resolver mapping. Normal interactive access needs equivalent DNS/hosts entries. No eager worker, auth bypass or substituted storage was used. No application college-ID branch or new public route was introduced. [Inventory](inventory.json) was captured before final correction-account cleanup; `cleanup-verification.json` records the final IAM state. [Private draft correction](college-copy-draft.png) and the final public Page screenshots show the copy revision.





- **57 backend tests passed**, no failures/skips: templates, homepage assignment, sidebar widgets, menu locations and Site resolution. [JUnit](backend-tests.xml), [console](backend-tests.txt).


- **40 frontend component tests passed** across menu management, Post workflow, homepage assignment/catalogue and sidebar management. [Core JUnit](component-tests.xml), [template/sidebar JUnit](template-sidebar-tests.xml).


- **40 live two-Site negative cases passed**, including source-row count equality after rejected reference writes and POSTS restoration in `finally`. [Results](isolation.json).


- Real-browser editor/upload/review/admin-publish paths, anonymous draft denial, public desktop/mobile rendering and fresh Viewer denial passed. [Progress](progress.json), [browser traces](api-trace.json), [Django method/path/status traces](django-http-trace.json).


- Phone viewport has no horizontal overflow. Keyboard Enter opens the college header menu; Escape closes it. [Phone](college-phone.png), [keyboard-open menu](college-phone-menu.png), [assertions](public-isolation.json). This is targeted accessibility evidence, not a full manual WCAG audit.


- Production builds and TypeScript evidence are reused from the preceding Main workflow because the verified application frontend files are byte-identical; this task changes only QA scripts/evidence. [Hash comparison](build-reuse.json), [prior verified builds](../main-workflow-2026-11-21/final-builds.json). The browser workflow itself ran on development services, not production Next.js.


- No schema/API contract changed. Existing migration leaves are applied ([inventory](inventory.json)); no new migration/DDL rollback was necessary. Existing public renderer and publication APIs are reused.





## Rehearsals and defect disposition





No new blocking application authorization or data-integrity defect was found. The following harness/operational findings are retained rather than represented as a first-pass green run:





- A development sign-in request returned gateway 502. [Initial failure](rehearsal-sign-in-failure.json). Bounded retries recover only 5xx navigation responses, while application assertions still fail normally.


- The long combined UI run outlived the captured API bearer token. Its direct Viewer probe correctly returned 401; refreshing credentials and rerunning produced the required permission-specific 403. [Expired-token rehearsal](rehearsal-expired-api-token.json). The staged PowerShell wrapper now refreshes credentials for each stage.


- The HTTP harness initially omitted nginx's allowed Host header, omitted required rich-text content in a negative Post payload, and expected 403 for a module gate whose established contract is field-addressed 400. Corrected inputs exercise the intended foreign-reference/module checks; no application permission relaxation was made. Public forged Site filters also follow their documented 400 validation contract.


- A public comparison selector assumed a `main` element, and a run-directory mismatch was refused by the driver's run-ID guard. The comparison now uses the rendered body and explicit output directory. Neither failure changed Site data.


- Visual QA caught literal Main-specific wording inherited by the shared test Page fixture. It was entered by the harness, not retrieved from Main. The fixture is now parameterized; the college Page was corrected through an approved private working draft and republished. This is a test-content correction, not an isolation defect.





The shared initial upload checkpoint retained its old ?Main private media library? label in progress evidence. Actual request paths, ownership inventory and screenshots are Site 19; subsequent driver labels refer to the active Site. A correction attempt also hit a development draft-opening/navigation timeout while the created working draft remained intact and reachable; the Pages dashboard showed a 12-second summary timeout. These recovered development timing failures remain operational follow-up, not performance acceptance. Template starter descriptions and logo placeholders remain deliberate review content. This is not a finished editorial university/college design.





## Handoff and remaining approval





The active college, homepage, article, Page, reusable sidebar, three menus and uploaded asset remain for inspection. Main content/domain/module/menu/homepage configuration remains unchanged. All **nine** generated accounts are disabled, their memberships revoked and private credential journals removed ([final database verification](cleanup-verification.json)); [Initial cleanup](initial-cleanup.json), [correction-profile cleanup](cleanup.json) and final anonymous assertions ([public-isolation.json](public-isolation.json)) record this handoff. Normal development services remain running.





External code review, Issue/PR attachment, QA/Product/Security approval as applicable and a final immutable-release/production-deployment check remain pending. The independent [PERF-010 cached-return timing blocker](../P0-PERF-010/2026-11-20/README.md) is **not cleared** by this functional story. Full release/Definition-of-Done approval is not claimed.


