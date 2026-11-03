# Sprint 1 & Sprint 2 Integrated Acceptance Report

**Issue:** P2-QA-GATE-001 · **Execution date:** 2026-11-02 (Africa/Nairobi)

**Technical recommendation: NO-GO.** A signed Keycloak realm role bypasses
database Site authorization for Page administration. This is an automatic
security-gate failure. No approved exception or stakeholder release approval exists.

**38 cases assessed: 28 PASS, 9 FAIL, 1 BLOCKED.** T23 was retested
on 3 November 2026. The other case results are the 2 November gate.
This does not mean all 38 passed or were fully executed: blocked cases remain
unaccepted, and a successful subcheck never overrides a failing boundary.

## Build and execution provenance

- Branch `P2-FE-010`, commit `cd704d3f8743dafd65f91ced302a704033977c9a`. Application source was clean at the
  start. Only QA drivers/reports were added; application defects were not fixed
  or hidden during this gate. No commit or push was made.
- Real existing local Docker Compose stack: Django 5.1.8 / Python 3.12.15 /
  PostgreSQL 16 / Keycloak 26.8.1 / Next.js 15.5.28 / Node 22.23.3.
  Frontend `API_MODE=live`. Actual Edge/Chromium via Playwright automation.
- API traffic traversed Nginx and actual Keycloak-signed tokens. Browser tests
  exercised real Next.js and authorization-code login. No standalone HTML
  simulation or mocked API served as integrated acceptance evidence.
- Canonical run `qa09b58674`: University-root-owned Site 6 and
  College-owned Site 7; distinct `.uog.local` hostnames, same Page slug,
  distinct published content, and explicit Site/CMS role bindings.
- A dedicated QA platform administrator was bootstrapped by controlled local
  DB assignment after real Keycloak authentication. Site user assignments and
  content used protected APIs; no existing user's privileges were widened.
- The existing development-write opt-in was temporarily enabled because the
  starting environment disabled it. It was restored to false afterward.
- **Declared deviation:** module-management HTTP requests returned 500.
  Explicit system fixture switches enabled downstream checks; T10/T11 remain
  FAIL and the continuous unmodified workflow is **not** certified complete.

## Acceptance results

Every row carries its build, date, tester, expected/actual result, defect and
evidence in [results.csv](results.csv) and [results.json](results.json).

| ID | Result | Expected | Actual | Evidence / defect |
| --- | --- | --- | --- | --- |
| T01 | **PASS** | All required Docker services start and communicate. | All twelve long-running services running; every configured healthcheck healthy. Celery Beat has no healthcheck. Initializer jobs exit 0. | [compose-status-after.json](evidence/compose-status-after.json) |
| T02 | **PASS** | Migrations succeed on clean and existing PostgreSQL. | Real PostgreSQL test DB created/migrated for regression; existing environment migrate --check and migration drift checks exit 0. This is not a fresh full-stack deployment. | [migration-checks.json](evidence/migration-checks.json), [backend.junit.xml](evidence/backend.junit.xml) |
| T03 | **PASS** | Platform Administrator manages Organizations and hierarchy. | Created/edited a QA College under the existing University root and retrieved descendants via authenticated HTTP; hierarchy regression also passes. | [live-results.json](evidence/live-results.json), [http-transcript.json](evidence/http-transcript.json), [backend.junit.xml](evidence/backend.junit.xml) |
| T04 | **PASS** | Invalid organization relationships and unauthorized changes are denied. | Self-parent request returned 400; Viewer Organization creation returned 403; cycle/concurrent hierarchy regression passed. | [live-results.json](evidence/live-results.json), [backend.junit.xml](evidence/backend.junit.xml) |
| T05 | **PASS** | Organization data survives an application restart. | Restarted Django container, waited for readiness, then retrieved unchanged Organization and both Sites/ownership over authenticated HTTP. | [live-results.json](evidence/live-results.json) |
| T06 | **PASS** | Two Sites have separate owners and configurations. | Sites 6 and 7 belong to University root and QA College respectively; distinct identity/theme configuration and same-slug published Pages remained isolated. | [live-results.json](evidence/live-results.json), [browser-public-results.json](evidence/browser-public-results.json) |
| T07 | **PASS** | Site lifecycle, ownership and template persist. | Selected existing active template, created and activated both Sites, updated allowlisted configuration and verified ownership after restart; lifecycle/template regression passes. | [live-results.json](evidence/live-results.json), [backend.junit.xml](evidence/backend.junit.xml) |
| T08 | **PASS** | Primary domains/aliases are assigned and duplicates denied. | Created a primary and alias for each Site; duplicate cross-Site hostname returned 409. | [http-transcript.json](evidence/http-transcript.json) |
| T09 | **PASS** | Valid hosts resolve correctly; unknown hosts fail safely. | Both QA hostnames returned their own Site IDs; unknown hostname returned 404. Real browser hostname mapping rendered each Site independently. | [live-results.json](evidence/live-results.json), [browser-public-results.json](evidence/browser-public-results.json) |
| T10 | **FAIL** | Pages, Posts and Menus can be activated independently per Site. | Global POSTS activation PATCH returned 500 (select_for_update outside transaction). A declared system fixture workaround enabled downstream tests; it does not make this case pass. | [live-results.json](evidence/live-results.json), [http-transcript.json](evidence/http-transcript.json) · QA-D001 |
| T11 | **FAIL** | Module disable enforces APIs/UI and preserves data. | Management enable/disable returns 500. After an explicit system fixture switch, POSTS public feed returns 404 with rows retained and MENUS public UI disappears. Content enforcement passed; management workflow failed. | [live-results.json](evidence/live-results.json), [browser-module-results.json](evidence/browser-module-results.json), [public-menus-disabled.png](evidence/public-menus-disabled.png) · QA-D001 |
| T12 | **FAIL** | Keycloak login/logout, token validation and sessions work. | Real authorization-code login and HTTP-only Auth.js session succeeded. Tampered/expired real JWTs returned 401. RP sign-out stops at Keycloak Invalid redirect uri; completion unverified. | [browser-results.json](evidence/browser-results.json), [T12-logout-failure.png](evidence/T12-logout-failure.png), [live-results.json](evidence/live-results.json), [cleanup.json](evidence/cleanup.json) · QA-D003 |
| T13 | **FAIL** | Platform Administrator manages Site user assignments. | Real assignment/CMS-role APIs succeeded. Authenticated administrator access screen displayed no effective permissions or roles despite DB grant, so the UI workflow is not accepted. | [http-transcript.json](evidence/http-transcript.json), [admin-access.png](evidence/admin-access.png), [frontend-typecheck.log](evidence/frontend-typecheck.log) · QA-D004 |
| T14 | **PASS** | Site Administrator manages only its Site and delegated users. | Managed own Menu; delegated a read-only role in Site A (201), same delegation in Site B denied (403); Site B resource retrieval denied. | [live-results.json](evidence/live-results.json), [http-transcript.json](evidence/http-transcript.json) |
| T15 | **FAIL** | Editor/Reviewer/Viewer match approved registry. | Separate CMS actors completed correct author/reviewer/publisher operations, but effective-permission inspection returned 500 for Editor, Reviewer and Viewer. Registry enforcement is also contradicted by SEC001. | [live-results.json](evidence/live-results.json), [http-transcript.json](evidence/http-transcript.json) · QA-D002;QA-SEC001 |
| T16 | **FAIL** | Site A principal cannot read or modify Site B. | Normal Editor/Viewer boundaries deny access. A real Keycloak platform-admin realm claim alone elevated a Site A Viewer to GET 200 and POST 201 on Site B Pages without any platform/Site B DB grant. | [live-results.json](evidence/live-results.json), [http-transcript.json](evidence/http-transcript.json) · QA-SEC001 |
| T17 | **FAIL** | Manipulated IDs, expired tokens and unauthorized actions are denied. | Malformed ID returned 404; tampered and expired real Keycloak tokens returned 401. Realm-role-only unauthorized cross-Site creation nevertheless returned 201. | [live-results.json](evidence/live-results.json), [http-transcript.json](evidence/http-transcript.json) · QA-SEC001 |
| T18 | **PASS** | Authorized users create/update/list/retrieve Site Pages. | Site Editor created and conditionally edited its Page through HTTP; detail, inventory, and backend Page API regression exercised. | [live-results.json](evidence/live-results.json), [http-transcript.json](evidence/http-transcript.json), [backend.junit.xml](evidence/backend.junit.xml) |
| T19 | **PASS** | Page slugs, hierarchy, metadata and blocks are validated. | Actual invalid block type rejected 400 and SEO edit succeeded; PostgreSQL Page hierarchy/route/metadata/block validation suites passed. | [live-results.json](evidence/live-results.json), [backend.junit.xml](evidence/backend.junit.xml) |
| T20 | **PASS** | Draft/review/approval/publication follows workflow. | Two Sites completed submit -> approve -> publish with distinct real Keycloak author, reviewer and publisher identities and explicit Site CMS assignments. | [live-results.json](evidence/live-results.json), [http-transcript.json](evidence/http-transcript.json) |
| T21 | **PASS** | Unauthorized publication and invalid transitions are rejected. | Ordinary Viewer publish request returned 403; invalid-transition/separation-of-duties regression passed. This limited workflow case does not waive SEC001. | [live-results.json](evidence/live-results.json), [backend.junit.xml](evidence/backend.junit.xml) |
| T22 | **PASS** | Unpublished Pages are not publicly delivered. | Both draft Page routes returned 404 before publication; draft/hidden/unpublish regression passed. | [live-results.json](evidence/live-results.json), [backend.junit.xml](evidence/backend.junit.xml) |
| T23 | **PASS** | Published content stays stable while a new draft is edited. | Direct PATCH of the published Page returned 400. A working draft was edited, reviewed by a different person, and published onto the same route. Public delivery stayed on version 1 until publication, then served version 2. Unpublish returned 404. | [t23-working-draft.md](evidence/t23-working-draft.md), [t23-working-draft.png](evidence/t23-working-draft.png) · QA-GAP001 |
| T24 | **PASS** | Posts support authoring/editing/taxonomy/excerpts. | Editor created categorized/tagged Post with excerpt, published it, and created/edited a separate draft Post over HTTP. | [live-results.json](evidence/live-results.json), [http-transcript.json](evidence/http-transcript.json) |
| T25 | **PASS** | Post slugs and taxonomies are Site-scoped. | Cross-Site category reference rejected 400; Post/taxonomy slug, uniqueness and ownership regression passed. | [live-results.json](evidence/live-results.json), [backend.junit.xml](evidence/backend.junit.xml) |
| T26 | **PASS** | Posts use shared CMS publishing. | Post completed shared CMS submit/approve/publish API and persisted as PUBLISHED in SiteContent; no standalone news workflow was substituted. | [live-results.json](evidence/live-results.json), [backend.junit.xml](evidence/backend.junit.xml) |
| T27 | **PASS** | Public Post feeds/details contain only owning published content. | Published Post appeared in own hostname feed and real Next.js detail, absent from other Site feed/detail; draft/publication regressions passed. | [live-results.json](evidence/live-results.json), [browser-public-results.json](evidence/browser-public-results.json), [backend.junit.xml](evidence/backend.junit.xml) |
| T28 | **PASS** | Authorized users create Site menus and nested items. | Real Site administrator created/activated header Menu and parent/child items with owning Menu If-Match tokens. | [live-results.json](evidence/live-results.json), [http-transcript.json](evidence/http-transcript.json) |
| T29 | **PASS** | Menu ordering, parents and locations are validated. | Real tree retrieved; atomic reorder, invalid depth/parent/location and concurrent mutation regression suites passed. | [live-results.json](evidence/live-results.json), [backend.junit.xml](evidence/backend.junit.xml) |
| T30 | **PASS** | Public navigation is Site-correct and handles unavailable targets. | Real Next.js QA Home navigation opened same-Site published Page; added draft Page target was omitted from public menu; unsafe script URL rejected. | [live-results.json](evidence/live-results.json), [browser-public-results.json](evidence/browser-public-results.json), [http-transcript.json](evidence/http-transcript.json) |
| T31 | **PASS** | Real public Next.js Pages and Posts respect Host isolation. | Actual Edge rendered distinct main/college published Page markers on respective hostnames and own Post only. Site chrome code matched the host; no foreign marker rendered. | [browser-public-results.json](evidence/browser-public-results.json), [public-page-0-desktop.png](evidence/public-page-0-desktop.png), [public-page-1-desktop.png](evidence/public-page-1-desktop.png), [public-post.png](evidence/public-post.png) |
| T32 | **PASS** | Core layouts/navigation support responsive keyboard access. | 390x844, 768x1024 and 1440x1000: no horizontal overflow; keyboard opened/closed mobile navigation and focused desktop link. Stabilized screenshots visually reviewed; not a full WCAG certification. | [browser-public-results.json](evidence/browser-public-results.json), [public-mobile.png](evidence/public-mobile.png), [public-tablet.png](evidence/public-tablet.png), [public-desktop.png](evidence/public-desktop.png) |
| T33 | **PASS** | Swagger/OpenAPI cover implemented contracts. | Schema generated and validated without warnings, matches repository snapshot (80 paths). Schema, Swagger and ReDoc each HTTP 200. | [platform-checks.json](evidence/platform-checks.json), [generated-openapi.yaml](evidence/generated-openapi.yaml), [backend.junit.xml](evidence/backend.junit.xml) |
| T34 | **PASS** | Invalid ordinary payloads/IDs/auth fail predictably. | Missing fields returned structured 400 with correlation UUID; invalid blocks 400, malformed ID 404, bad JWTs 401. Known valid administration requests causing 500 are tracked under D001/D002, not excused. | [http-transcript.json](evidence/http-transcript.json), [live-results.json](evidence/live-results.json), [backend.junit.xml](evidence/backend.junit.xml) |
| T35 | **FAIL** | Security includes IDOR, XSS, redirects and escalation. | Actual script block sanitized, unsafe Menu scheme rejected, and invalid JWTs denied; genuine signed realm-role claim still bypasses cross-Site Page authorization. Automatic No-Go. | [live-results.json](evidence/live-results.json), [http-transcript.json](evidence/http-transcript.json), [backend.junit.xml](evidence/backend.junit.xml) · QA-SEC001 |
| T36 | **PASS** | Administrative changes produce agreed audit records. | Persisted shared events carry QA Site context (13 observed before later probes); create/update/move/reorder/lifecycle and fail-closed writer regression passed. | [live-results.json](evidence/live-results.json), [backend.junit.xml](evidence/backend.junit.xml), [cleanup.json](evidence/cleanup.json) |
| T37 | **FAIL** | Backend/frontend/E2E regressions are green in CI. | Backend rerun 3 Nov 2026: 627 passed, 0 failed, 2 skipped (docs-tree skips). The earlier inventory failure is corrected. Frontend Admin 257 passed/32 failed/12 unhandled errors; UI 86 passed; API client 157 passed. Typecheck fails with 13 Admin diagnostics. Remote CI run/link not available. | [backend.junit.xml](evidence/backend.junit.xml), [backend-regression.log](evidence/backend-regression.log), [frontend-tests.log](evidence/frontend-tests.log), [frontend-typecheck.log](evidence/frontend-typecheck.log) · QA-D005 |
| T38 | **BLOCKED** | A fresh deployment repeats the complete acceptance flow. | No isolated fresh full-stack installation executed; existing data volumes preserved. Clean test DB migrations passed, but unmodified full workflow is already blocked by module-management and security defects. | [migration-checks.json](evidence/migration-checks.json), [live-results.json](evidence/live-results.json), [compose-status-after.json](evidence/compose-status-after.json) · QA-D001;QA-SEC001 |

## Defects, limitations and release criteria

See [defects.md](defects.md) for reproduction, expected/actual behavior,
source locations, priorities and proposed remediation. Open P1 findings include
cross-Site authorization, module-management failures, effective-permission
failure, logout configuration drift, access-management UI failure and the
remaining admin, typecheck, and CI portions of the release regression. The
backend route-inventory portion of QA-D005 was corrected on 3 November 2026.
QA-D005 stays open. No exception is approved.

Local regression is not remote CI evidence. Azure pipeline run URL/results were
not provided or retrieved. This package is ready to attach to Azure DevOps,
but has not been uploaded and the issue must remain open.

T23 was demonstrated on 3 November 2026 with a working draft. The published
Page stayed locked, and public delivery kept the previous snapshot until the
reviewed publication. T38 requires an isolated fresh deployment after blockers
are fixed. No existing database volume was reset to simulate a fresh install.

## Cleanup and retained evidence

[Cleanup record](evidence/cleanup.json): 12 dedicated Keycloak users disabled
and sessions logged out; 8 application grants revoked; 6 QA CMS role bindings
removed; temporary realm role removed; 3 private session/credential files
deleted. Original global POSTS switch and development-write configuration restored.
[Final environment](evidence/environment-after.json) confirms development writes
off; [Compose status](evidence/compose-status-after.json) records service health.

QA Organizations 13/14 and Sites 5/6/7 remain for traceability; Site 5 is an
incomplete harness setup attempt, not a passing business workflow. The canonical
workflow uses Sites 6/7. These are synthetic local fixtures, not a replacement
for the institution's existing main Site. No existing business records or
volumes were deleted. Browser profile was temporary and closed.

The original T13 browser smoke proved that a shell loaded, **not** that access
management worked. Artifact review of `admin-access.png` found no effective
permissions/roles despite a valid administrator grant; the final T13 is FAIL.
Responsive screenshots were re-captured after drawer animations settled and
visually reviewed. No passwords, live tokens, cookies or HAR traces are included.

## Sign-off record

This is an automated technical recommendation, not synthesized institutional
approval. The requested signed release decision is **pending**.

| Role | Name / signature | Decision | Date |
| --- | --- | --- | --- |
| QA Lead | Pending | Pending | Pending |
| Technical Lead | Pending | Pending | Pending |
| Product Owner | Pending | Pending | Pending |

Assessment author: Codex automated QA and evidence review, 2026-11-02.
Recommendation: **NO-GO**. The gate cannot be closed until security is fixed,
regressions pass, blocked cases execute, remote CI evidence is linked and the
three stakeholders record their actual decisions.
