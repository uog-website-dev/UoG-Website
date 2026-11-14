# Reusable sidebar acceptance evidence — 2026-11-14

Baseline commit: `132d3b8ae42f52c61dc453b079c841ede2b0d79e`. The working-tree source hashes are in `source-manifest.json`. This report records implementation checks on real local services; it is separate from prototype acceptance and independent human approval.

## Implementation decision

The Sprint 3 builder has reusable section templates, but insertion clones their content. It has no canonical shared sidebar region. The existing Page shell and Site Menu component were reused; `cms.Sidebar` supplies only the missing reusable identity, ordered references, lifecycle and guarded assignment. The initial sidebar palette contains Menu components, not an unrestricted second widget builder.

One Site-owned definition can be referenced by multiple Pages. Page revisions and publication snapshots freeze the eligible navigation projection. Subsequent definition/Menu edits cannot silently replace reviewed public presentation. Explicit Menu withdrawal or MENUS disablement suppresses navigation after every cache read; re-enabling restores the frozen projection.

## Acceptance matrix

| Criterion | Checks and actual result |
| --- | --- |
| AC-01 named sidebar and assignment | API create/assign tests; real Keycloak Editor created the region and assigned it through Page administration |
| AC-02 reopen and published rendering | Editor save/reopen and private preview passed; real-service review/publication and anonymous browser rendering passed |
| AC-03 shared identity | Two Pages reference the same Sidebar UUID; only one canonical definition exists; both published layouts render its frozen projection |
| AC-04 Site boundary | Foreign Menu/Sidebar IDs rejected; DB guards reject bulk ownership reassignment and foreign Page assignment |
| AC-05 permissions | Reviewer/Publisher write attempts and anonymous access rejected; canonical CMS grants and existing Page permissions reused |
| AC-06 deletion safety | Assigned delete/archive denied; protected FK and serialized DB writes; unused conditional deletion succeeds; real published-reference deletion denied |
| AC-07 invalid/conflicting components | Foreign/inactive Menu, unknown component, duplicate node ID, duplicate Menu and empty component arrays rejected atomically with field paths |
| AC-08 draft/public isolation | Draft assignment/removal does not replace the public snapshot; dependency changes block promotion; later sidebar rename leaves published Pages unchanged |

## Automated evidence

- Broad backend run: **1,070 passed, five skipped, one model-catalog assertion failed** because its approved model set needed `Sidebar`. The assertion was updated and passed in the final focused run. Raw [broad JUnit](backend-tests.xml) and [log](backend-all.log) are retained for transparency.
- Final focused backend run: **63 passed, one skipped**, including the latest sidebar API/SQL guards and cache-withdrawal regression, Page API/layout regressions, serializer and route contracts, application import/model catalog and OpenAPI. See [final JUnit](backend-final.xml) and [log](backend-final.log). All identified failures were resolved.
- Frontend workspace: **904 passed** — 537 admin, 202 UI, 165 API client; [log](frontend-all.log).
- Focused frontend evidence: [management component](sidebar-component.xml), [Page assignment editor](page-editor-tests.xml), [shared renderer/security](renderer-tests.xml).
- Workspace TypeScript: [passed](typecheck.log).
- Production Next.js builds: [admin](admin-build.log) and [public](public-build.log), both passed using isolated build directories.
- OpenAPI generated with `--validate --fail-on-warn`; [schema](../../api/openapi.yaml) contains the two sidebar routes, bounded typed Menu component input, Page assignment and read-only frozen snapshot.

The broad regression run initially identified approved-field/path baselines needing the new contract entries, , the application model catalog, and an outdated Full Width server-action expectation from P4-PAGE-001. Those assertions were updated to the implemented contract. A typed-UUID-to-JSON persistence failure was found by the real HTTP/browser probe and corrected by canonical normalization before persistence. Final evidence is collected after these corrections.

## Real-service and browser results

Environment: Windows headless Edge **157.0.4341.46**, Next.js, Django, PostgreSQL, Keycloak and Nginx. No mocked identity, authorization bypass, browser request interception or storage doubles were used. Generated Sites are `sidebar-ba2cff8b41a.uog.local` and `sidebar-ba2cff8b41b.uog.local`. The author has only Site A membership after seed cleanup. The fixture retains the existing 60/40 visual builder tree.

- [Authoring browser](browser-authoring.json): **four checks passed** — named Menu-based sidebar creation, 390px management with no overflow, draft preview/save/reopen with builder preservation, unchanged public Page before publication.
- [Publication integration](publication-integration.json): separate actors submit/review/publish; two published Pages share one sidebar; later rename does not rewrite the publication snapshot; assigned deletion is rejected.
- [Public browser](browser-public.json): **seven checks passed** — Left/Right Sidebar at 1440, 768 and 390px plus independent-Site isolation. Actual Tab traversal reaches the navigation link. Six scoped WCAG A/AA axe scans report **zero violations and zero incomplete checks**. This is scoped sidebar evidence, not whole-product accessibility certification.
- [Authenticated runtime API](runtime-api.json): real Keycloak token, HTTP 201 create and HTTP 204 unused deletion; probe cleaned up.
- Screenshots: [management desktop](management-desktop.png), [management phone](management-mobile.png), [private Page preview](assignment-private-preview.png), [published desktop](published-left_sidebar-1440.png), [published phone](published-left_sidebar-390.png). Other viewport/layout images are alongside this report.
- [Cleanup](cleanup.json): generated Keycloak identity disabled, local identity disabled, memberships revoked and private credential session removed. Generated content remains as immutable/audited QA evidence; no user credentials are in this folder.

Rehearsal scripts: `scripts/qa-sidebars-seed.py`, `qa-sidebars-browser.cjs`, `qa-sidebars-publish.py`, `qa-sidebars-public.cjs`, `qa-sidebars-cleanup.py`. Supply private configuration/session JSON on stdin. Playwright and axe paths are supplied by `UOG_QA_PLAYWRIGHT_ROOT` and `UOG_QA_AXE_PATH`. Copy `scripts/sprint3_live_review.py` alongside the seed/cleanup helpers in the backend `/tmp` directory. The seed receives `KC_ADMIN_USERNAME`, `KC_ADMIN_PASSWORD` and `KEYCLOAK_BACKEND_API_SECRET` through private stdin configuration. Run against healthy, warm development services; service restarts during browser requests invalidate a walkthrough and require a fresh run.

## Migration and rollback

[Migration rehearsal](migration-rehearsal.json): applied/downgraded/reapplied `cms.0023` around the previous CMS baseline with **31 existing Pages and 65 publication snapshots**. Their content hash remained identical through rollback and upgrade. The clean-database test run applies the complete migration graph. The new model is indexed by `(site, status)`, unique `(site, name)` and the protected Page sidebar FK.

The rehearsal refuses destructive rollback when sidebar data exists. A populated production release requires backup/export and assignment reconciliation before downgrade; use a forward fix where possible. No existing Page body or historical snapshot is rewritten by the migration.

## Review handoff

[Administrator/API guidance](../../reusable-sidebars.md). The deletion policy intentionally protects all retained Page assignments, including archived drafts. The component palette is intentionally Menu-only in this release. Independent code review/approval, PR creation and Azure Issue attachment remain project workflow steps; they are not claimed as completed by this local implementation evidence.
