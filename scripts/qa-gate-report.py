"""Render the assessed QA gate from preserved real-stack execution evidence."""
import csv
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs/qa/P2-QA-GATE-001'
E = OUT / 'evidence'
live = json.loads((E/'live-results.json').read_text(encoding='utf-8-sig'))
build = live['state']['build']
checks = {
 1: ('PASS','All required Docker services start and communicate.','All twelve long-running services running; every configured healthcheck healthy. Celery Beat has no healthcheck. Initializer jobs exit 0.', 'compose-status-after.json', ''),
 2: ('PASS','Migrations succeed on clean and existing PostgreSQL.','Real PostgreSQL test DB created/migrated for regression; existing environment migrate --check and migration drift checks exit 0. This is not a fresh full-stack deployment.', 'migration-checks.json;backend.junit.xml', ''),
 3: ('PASS','Platform Administrator manages Organizations and hierarchy.','Created/edited a QA College under the existing University root and retrieved descendants via authenticated HTTP; hierarchy regression also passes.', 'live-results.json;http-transcript.json;backend.junit.xml', ''),
 4: ('PASS','Invalid organization relationships and unauthorized changes are denied.','Self-parent request returned 400; Viewer Organization creation returned 403; cycle/concurrent hierarchy regression passed.', 'live-results.json;backend.junit.xml', ''),
 5: ('PASS','Organization data survives an application restart.','Restarted Django container, waited for readiness, then retrieved unchanged Organization and both Sites/ownership over authenticated HTTP.', 'live-results.json', ''),
 6: ('PASS','Two Sites have separate owners and configurations.','Sites 6 and 7 belong to University root and QA College respectively; distinct identity/theme configuration and same-slug published Pages remained isolated.', 'live-results.json;browser-public-results.json', ''),
 7: ('PASS','Site lifecycle, ownership and template persist.','Selected existing active template, created and activated both Sites, updated allowlisted configuration and verified ownership after restart; lifecycle/template regression passes.', 'live-results.json;backend.junit.xml', ''),
 8: ('PASS','Primary domains/aliases are assigned and duplicates denied.','Created a primary and alias for each Site; duplicate cross-Site hostname returned 409.', 'http-transcript.json', ''),
 9: ('PASS','Valid hosts resolve correctly; unknown hosts fail safely.','Both QA hostnames returned their own Site IDs; unknown hostname returned 404. Real browser hostname mapping rendered each Site independently.', 'live-results.json;browser-public-results.json', ''),
 10: ('FAIL','Pages, Posts and Menus can be activated independently per Site.','Global POSTS activation PATCH returned 500 (select_for_update outside transaction). A declared system fixture workaround enabled downstream tests; it does not make this case pass.', 'live-results.json;http-transcript.json', 'QA-D001'),
 11: ('FAIL','Module disable enforces APIs/UI and preserves data.','Management enable/disable returns 500. After an explicit system fixture switch, POSTS public feed returns 404 with rows retained and MENUS public UI disappears. Content enforcement passed; management workflow failed.', 'live-results.json;browser-module-results.json;public-menus-disabled.png', 'QA-D001'),
 12: ('FAIL','Keycloak login/logout, token validation and sessions work.','Real authorization-code login and HTTP-only Auth.js session succeeded. Tampered/expired real JWTs returned 401. RP sign-out stops at Keycloak Invalid redirect uri; completion unverified.', 'browser-results.json;T12-logout-failure.png;live-results.json;cleanup.json', 'QA-D003'),
 13: ('FAIL','Platform Administrator manages Site user assignments.','Real assignment/CMS-role APIs succeeded. Authenticated administrator access screen displayed no effective permissions or roles despite DB grant, so the UI workflow is not accepted.', 'http-transcript.json;admin-access.png;frontend-typecheck.log', 'QA-D004'),
 14: ('PASS','Site Administrator manages only its Site and delegated users.','Managed own Menu; delegated a read-only role in Site A (201), same delegation in Site B denied (403); Site B resource retrieval denied.', 'live-results.json;http-transcript.json', ''),
 15: ('FAIL','Editor/Reviewer/Viewer match approved registry.','Separate CMS actors completed correct author/reviewer/publisher operations, but effective-permission inspection returned 500 for Editor, Reviewer and Viewer. Registry enforcement is also contradicted by SEC001.', 'live-results.json;http-transcript.json', 'QA-D002;QA-SEC001'),
 16: ('FAIL','Site A principal cannot read or modify Site B.','Normal Editor/Viewer boundaries deny access. A real Keycloak platform-admin realm claim alone elevated a Site A Viewer to GET 200 and POST 201 on Site B Pages without any platform/Site B DB grant.', 'live-results.json;http-transcript.json', 'QA-SEC001'),
 17: ('FAIL','Manipulated IDs, expired tokens and unauthorized actions are denied.','Malformed ID returned 404; tampered and expired real Keycloak tokens returned 401. Realm-role-only unauthorized cross-Site creation nevertheless returned 201.', 'live-results.json;http-transcript.json', 'QA-SEC001'),
 18: ('PASS','Authorized users create/update/list/retrieve Site Pages.','Site Editor created and conditionally edited its Page through HTTP; detail, inventory, and backend Page API regression exercised.', 'live-results.json;http-transcript.json;backend.junit.xml', ''),
 19: ('PASS','Page slugs, hierarchy, metadata and blocks are validated.','Actual invalid block type rejected 400 and SEO edit succeeded; PostgreSQL Page hierarchy/route/metadata/block validation suites passed.', 'live-results.json;backend.junit.xml', ''),
 20: ('PASS','Draft/review/approval/publication follows workflow.','Two Sites completed submit -> approve -> publish with distinct real Keycloak author, reviewer and publisher identities and explicit Site CMS assignments.', 'live-results.json;http-transcript.json', ''),
 21: ('PASS','Unauthorized publication and invalid transitions are rejected.','Ordinary Viewer publish request returned 403; invalid-transition/separation-of-duties regression passed. This limited workflow case does not waive SEC001.', 'live-results.json;backend.junit.xml', ''),
 22: ('PASS','Unpublished Pages are not publicly delivered.','Both draft Page routes returned 404 before publication; draft/hidden/unpublish regression passed.', 'live-results.json;backend.junit.xml', ''),
 23: ('BLOCKED','Published content stays stable while a new draft is edited.','Direct edit of the published Page returned 400 and existing public snapshot stayed stable. No supported concurrent draft-fork workflow was demonstrated; a documented flow is required before this case can pass.', 'live-results.json;http-transcript.json', 'QA-GAP001'),
 24: ('PASS','Posts support authoring/editing/taxonomy/excerpts.','Editor created categorized/tagged Post with excerpt, published it, and created/edited a separate draft Post over HTTP.', 'live-results.json;http-transcript.json', ''),
 25: ('PASS','Post slugs and taxonomies are Site-scoped.','Cross-Site category reference rejected 400; Post/taxonomy slug, uniqueness and ownership regression passed.', 'live-results.json;backend.junit.xml', ''),
 26: ('PASS','Posts use shared CMS publishing.','Post completed shared CMS submit/approve/publish API and persisted as PUBLISHED in SiteContent; no standalone news workflow was substituted.', 'live-results.json;backend.junit.xml', ''),
 27: ('PASS','Public Post feeds/details contain only owning published content.','Published Post appeared in own hostname feed and real Next.js detail, absent from other Site feed/detail; draft/publication regressions passed.', 'live-results.json;browser-public-results.json;backend.junit.xml', ''),
 28: ('PASS','Authorized users create Site menus and nested items.','Real Site administrator created/activated header Menu and parent/child items with owning Menu If-Match tokens.', 'live-results.json;http-transcript.json', ''),
 29: ('PASS','Menu ordering, parents and locations are validated.','Real tree retrieved; atomic reorder, invalid depth/parent/location and concurrent mutation regression suites passed.', 'live-results.json;backend.junit.xml', ''),
 30: ('PASS','Public navigation is Site-correct and handles unavailable targets.','Real Next.js QA Home navigation opened same-Site published Page; added draft Page target was omitted from public menu; unsafe script URL rejected.', 'live-results.json;browser-public-results.json;http-transcript.json', ''),
 31: ('PASS','Real public Next.js Pages and Posts respect Host isolation.','Actual Edge rendered distinct main/college published Page markers on respective hostnames and own Post only. Site chrome code matched the host; no foreign marker rendered.', 'browser-public-results.json;public-page-0-desktop.png;public-page-1-desktop.png;public-post.png', ''),
 32: ('PASS','Core layouts/navigation support responsive keyboard access.','390x844, 768x1024 and 1440x1000: no horizontal overflow; keyboard opened/closed mobile navigation and focused desktop link. Stabilized screenshots visually reviewed; not a full WCAG certification.', 'browser-public-results.json;public-mobile.png;public-tablet.png;public-desktop.png', ''),
 33: ('PASS','Swagger/OpenAPI cover implemented contracts.','Schema generated and validated without warnings, matches repository snapshot (80 paths). Schema, Swagger and ReDoc each HTTP 200.', 'platform-checks.json;generated-openapi.yaml;backend.junit.xml', ''),
 34: ('PASS','Invalid ordinary payloads/IDs/auth fail predictably.','Missing fields returned structured 400 with correlation UUID; invalid blocks 400, malformed ID 404, bad JWTs 401. Known valid administration requests causing 500 are tracked under D001/D002, not excused.', 'http-transcript.json;live-results.json;backend.junit.xml', ''),
 35: ('FAIL','Security includes IDOR, XSS, redirects and escalation.','Actual script block sanitized, unsafe Menu scheme rejected, and invalid JWTs denied; genuine signed realm-role claim still bypasses cross-Site Page authorization. Automatic No-Go.', 'live-results.json;http-transcript.json;backend.junit.xml', 'QA-SEC001'),
 36: ('PASS','Administrative changes produce agreed audit records.','Persisted shared events carry QA Site context (13 observed before later probes); create/update/move/reorder/lifecycle and fail-closed writer regression passed.', 'live-results.json;backend.junit.xml;cleanup.json', ''),
 37: ('FAIL','Backend/frontend/E2E regressions are green in CI.','Local backend 626 passed/1 failed/2 skipped; frontend Admin 257 passed/32 failed/12 unhandled errors; UI 86 passed; API client 157 passed. Typecheck fails with 13 Admin diagnostics. Remote CI run/link not available.', 'backend.junit.xml;backend-regression.log;frontend-tests.log;frontend-typecheck.log', 'QA-D005'),
 38: ('BLOCKED','A fresh deployment repeats the complete acceptance flow.','No isolated fresh full-stack installation executed; existing data volumes preserved. Clean test DB migrations passed, but unmodified full workflow is already blocked by module-management and security defects.', 'migration-checks.json;live-results.json;compose-status-after.json', 'QA-D001;QA-SEC001'),
}
assert set(checks) == set(range(1,39))
rows=[]
for n,(status,expected,actual,evidence,defects) in checks.items():
    rows.append({'test_id':f'T{n:02}', 'status':status, 'expected':expected, 'actual':actual,
        'execution_date':'2026-11-02','tester':'Codex automated QA + artifact review',
        'environment':'Local Compose / real Django, PostgreSQL, Keycloak, Next.js, headless Edge',
        'build':build,'evidence':evidence,'defects':defects,'approved_exception':'None'})
counts=Counter(row['status'] for row in rows)
summary={'issue':'P2-QA-GATE-001','date':'2026-11-02','build':build,'branch':'P2-FE-010',
    'technical_recommendation':'NO-GO','formal_signoff':'PENDING - no stakeholder signatures supplied',
    'counts':dict(counts),'cases':rows,'approved_exceptions':[]}
(OUT/'results.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
with (OUT/'results.csv').open('w',encoding='utf-8-sig',newline='') as file:
    writer=csv.DictWriter(file,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)

header=f'''# Sprint 1 & Sprint 2 Integrated Acceptance Report

**Issue:** P2-QA-GATE-001 · **Execution date:** 2026-11-02 (Africa/Nairobi)

**Technical recommendation: NO-GO.** A signed Keycloak realm role bypasses
database Site authorization for Page administration. This is an automatic
security-gate failure. No approved exception or stakeholder release approval exists.

**38 cases assessed: {counts['PASS']} PASS, {counts['FAIL']} FAIL, {counts['BLOCKED']} BLOCKED.**
This does not mean all 38 passed or were fully executed: blocked cases remain
unaccepted, and a successful subcheck never overrides a failing boundary.

## Build and execution provenance

- Branch `P2-FE-010`, commit `{build}`. Application source was clean at the
  start. Only QA drivers/reports were added; application defects were not fixed
  or hidden during this gate. No commit or push was made.
- Real existing local Docker Compose stack: Django 5.1.8 / Python 3.12.15 /
  PostgreSQL 16 / Keycloak 26.8.1 / Next.js 15.5.28 / Node 22.23.3.
  Frontend `API_MODE=live`. Actual Edge/Chromium via Playwright automation.
- API traffic traversed Nginx and actual Keycloak-signed tokens. Browser tests
  exercised real Next.js and authorization-code login. No standalone HTML
  simulation or mocked API served as integrated acceptance evidence.
- Canonical run `{live['state']['run']}`: University-root-owned Site 6 and
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
'''
table=[]
for row in rows:
    links=', '.join(f'[{name}](evidence/{name})' for name in row['evidence'].split(';'))
    if row['defects']: links+=' · '+row['defects']
    table.append(f"| {row['test_id']} | **{row['status']}** | {row['expected']} | {row['actual']} | {links} |")
footer='''

## Defects, limitations and release criteria

See [defects.md](defects.md) for reproduction, expected/actual behavior,
source locations, priorities and proposed remediation. Open P1 findings include
cross-Site authorization, module-management failures, effective-permission
failure, logout configuration drift, access-management UI failure and release
regressions. No defect is recorded as resolved; no exception is approved.

Local regression is not remote CI evidence. Azure pipeline run URL/results were
not provided or retrieved. This package is ready to attach to Azure DevOps,
but has not been uploaded and the issue must remain open.

T23 needs a supported draft-fork workflow that leaves published content live.
Rejecting edits to published content is safe; removing that guard is not an
acceptable shortcut. T38 requires an isolated fresh deployment after blockers
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
'''
(OUT/'report.md').write_text(header+'\n'.join(table)+footer,encoding='utf-8')

# Evidence hygiene: never print matching content if an accidental credential appears.
jwt=re.compile(r'eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}')
for file in E.iterdir():
    if file.suffix in {'.json','.log','.xml','.yaml'}:
        text=file.read_text(encoding='utf-8-sig')
        assert not jwt.search(text), f'Possible token in {file.name}; remove before sharing.'
manifest={file.relative_to(OUT).as_posix():hashlib.sha256(file.read_bytes()).hexdigest()
          for file in OUT.rglob('*') if file.is_file() and file.name!='manifest.json'}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps({'counts':dict(counts),'recommendation':'NO-GO','artifact_files':len(manifest),'token_pattern_scan':'PASS'}))
