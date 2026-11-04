"""Assemble the November 4 gate from actual evidence; never reuse historical statuses."""
import ast
import csv
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs/qa/P2-QA-GATE-001'
E = OUT / 'evidence/rerun-2026-11-04'

def read(path):
    raw = path.read_bytes()
    return raw.decode('utf-16') if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else raw.decode('utf-8-sig')

def data(path):
    return json.loads(read(E / path))

# Only the checklist's expected descriptions are shared with the historical
# renderer. No old status, actual result, date, defect or evidence is imported.
tree = ast.parse((ROOT / 'scripts/qa-gate-report.py').read_text(encoding='utf-8'))
checklist = ast.literal_eval(next(node.value for node in tree.body if isinstance(node, ast.Assign)
    and any(isinstance(target, ast.Name) and target.id == 'checks' for target in node.targets)))
runs = {name: data(f'{name}/api-results.json') for name in ('existing', 'fresh')}
build = runs['existing']['state']['build']
assert all(run['state']['date'] == '2026-11-04' and run['state']['build'] == build
           and run['state']['completed_http_workflow'] for run in runs.values())
assert data('github-ci.json')['headSha'] == build
assert data('github-ci.json')['conclusion'] == 'success'
assert data('existing/persistence.json')['status'] == 'PASS'
assert all(data(f'{name}/cleanup.json')['disabled_qa_keycloak_users'] == 6 for name in runs)
assert all(run['state'].get('global_flags_restored_via_api') for run in runs.values())
public_checks = data('fresh/browser-public-results.json')['results']
assert len(public_checks) == 7 and all(row['status'] == 'PASS' for row in public_checks)
admin_checks = {row['id']: row for row in data('fresh/browser-first-results.json')['results']}
assert all(admin_checks[key]['status'] == 'PASS' for key in ('T12-browser', 'T13-browser', 'T12-logout'))
before = set(read(E / 'developer-volumes-before.txt').splitlines())
after = set(read(E / 'developer-volumes-after.txt').splitlines())
assert before <= after, 'A developer volume is missing.'

manual = {
 1: ('PASS', 'Twelve long-running services healthy on upgraded and fresh stacks (Celery Beat has no configured healthcheck); initializer jobs completed. Developer stack restored.', 'existing/services-before.txt;fresh/services.txt;existing/services-after.txt'),
 2: ('PASS', 'Fresh PostgreSQL applied the initial migration chain and served the workflow. Existing environment migrate --check and makemigrations --check --dry-run completed without drift.', 'fresh/migrations-startup.log;fresh/migration-check.log;existing/platform-checks.log;backend.junit.xml'),
 5: ('PASS', data('existing/persistence.json')['actual'], 'existing/persistence.json;restore-existing.log'),
 31: ('PASS', 'Actual Edge requests rendered both hostname-owned Page markers, own Post and no foreign Post; Site chrome matched each hostname.', 'existing/browser-results.json;fresh/browser-public-results.json;fresh/public-page-0-desktop.png;fresh/public-page-1-desktop.png'),
 32: ('PASS', 'Controlled browser execution passed keyboard navigation and overflow checks at 390x844, 768x1024 and 1440x1000. Initial fresh browser failures overlapped API module-disable probes; all observations remain in browser-first-results.json and failure screenshots.', 'existing/browser-results.json;fresh/browser-first-results.json;fresh/browser-public-results.json;fresh/public-mobile.png;fresh/public-tablet.png;fresh/public-desktop.png'),
 37: ('BLOCKED', 'Same-SHA GitHub CI passed backend/schema and frontend tests/typecheck/build; actual CI artifacts downloaded. Local backend: 647 passed/1 documentation skip, then 2 supplementary documentation tests passed. API client 157 and UI 86 passed. Initial Admin run: 304 passed/1 failed; focused rerun 10 passed, full serial rerun 305 passed. Typechecks and both production builds passed. Remote real-stack E2E is not defined/proven; initial timing failure remains tracked.', 'github-ci.json;remote-ci/;backend.junit.xml;documentation.junit.xml;frontend.log;post-test-rerun-corrected.log;admin-suite-serial.log;typecheck-final.log;frontend-build.log'),
 38: ('PASS', 'Dedicated project uog-gate-20261104 used new volumes, created the UNIVERSITY root through the API, and repeated the two-Site authenticated publication/isolation workflow. The same active-menu inventory defect is assessed FAIL in T28. QA containers removed, QA volumes retained for inspection, developer volumes preserved and original stack restored.', 'fresh-deployment.log;fresh/api-results.json;fresh/volumes.txt;fresh/cleanup.json;restore-existing.log;developer-volumes-before.txt;developer-volumes-after.txt'),
}
rows = []
for n in range(1, 39):
    case = f'T{n:02}'
    if n in manual:
        status, actual, evidence = manual[n]
    else:
        findings = [(name, entry) for name, run in runs.items() for entry in run['results'].get(case, [])]
        assert findings, f'No current evidence for {case}'
        valid = [(name, entry) for name, entry in findings if not entry.get('excluded_reason')]
        status = 'PASS' if all(entry['pass'] for _, entry in valid) else 'FAIL'
        actual = ' '.join(f"{name}: {entry['actual']}" for name, entry in valid)
        evidence = 'existing/api-results.json;existing/http-transcript.json;fresh/api-results.json;fresh/http-transcript.json;backend.junit.xml'
    if n in (12, 17):
        assert all(data(f'{name}/token-expiry.json')['status'] == 'PASS' for name in runs)
        actual += ' Real tokens in both stacks returned 401 after exp + 40 seconds; tampered tokens and anonymous writes returned 401.'
        evidence += ';existing/token-expiry.json;fresh/token-expiry.json'
    if n == 13:
        assert all(entry['status'] == 'PASS' for entry in data('fresh/browser-first-results.json')['results'] if entry['id'] == 'T13-browser')
        actual += ' Fresh Edge access screen waited for registry loading to finish and rendered effective permission chips, role registry and assignment controls. Existing first screenshot caught loading and alone is not UI completion evidence.'
        evidence += ';fresh/admin-access.png;fresh/browser-first-results.json'
    if n == 11:
        assert all(data(f'{name}/browser-module-results.json')['results'][0]['status'] == 'PASS' for name in runs)
        actual += ' Real browser navigation disappeared with MENUS disabled while Page content remained visible. Authorized Menu reads while disabled are allowed; edits return module_disabled.'
        evidence += ';existing/browser-module-results.json;fresh/browser-module-results.json'
    if n == 33:
        actual += ' Generated OpenAPI 3.0.3 has 81 paths, validates without warnings and matches docs/api/openapi.yaml. Production access-policy regression tests passed.'
        evidence += ';openapi.yaml;github-ci.json'
    if n == 36:
        actual += f" Fresh Site-context audit extract contains {len(data('fresh/audit.json')['events'])} events with actor, entity, request ID, changed fields and sanitized snapshots."
        evidence += ';fresh/audit.json'
    defects = 'QA-20261104-001' if n == 28 else 'QA-20261104-002;QA-20261104-003' if n == 37 else ''
    rows.append({'test_id': case, 'execution_date': '2026-11-04', 'tester': 'Codex automated API/browser QA and artifact inspection',
        'build': build, 'environment': 'Upgraded uog-digital-platform and isolated uog-gate-20261104; real Django/DRF, PostgreSQL, Keycloak, Next.js, Edge',
        'expected': checklist[n][1], 'actual': actual, 'status': status, 'evidence': evidence,
        'defects': defects, 'approved_exception': 'None'})

counts = dict(Counter(row['status'] for row in rows))
summary = {'issue': 'P2-QA-GATE-001', 'date': '2026-11-04', 'build': build,
           'technical_recommendation': 'NO-GO', 'counts': counts, 'cases': rows,
           'stakeholder_decisions': {role: 'PENDING — no genuine signed decision supplied' for role in ('QA Lead', 'Technical Lead', 'Product Owner')},
           'azure_issue_attachment': 'PENDING — no issue URL/authenticated work-item connection supplied', 'approved_exceptions': []}
(OUT / 'results-2026-11-04.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding='utf-8')
with (OUT / 'results-2026-11-04.csv').open('w', newline='', encoding='utf-8-sig') as stream:
    writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)

lines = [
 '# Sprint 1 & 2 integrated acceptance report — 4 November 2026', '',
 f'**Technical recommendation: NO-GO.** Results: {counts}. Reviewed application commit: `{build}`. No application source changes were made during this run. QA harness/report changes are uncommitted and included for review.', '',
 'This is a new execution record. November 2 and November 3 results were preserved. Tester: Codex automated real-HTTP/API and headless Edge checks, with screenshot/artifact inspection. This is not a stakeholder signature.', '',
 'The upgraded run was `' + runs['existing']['state']['run'] + '`; the fresh run was `' + runs['fresh']['state']['run'] + '`. Both used six dedicated Keycloak identities, the approved development-administrator bootstrap, then protected assignment/content/module APIs. No organization/content/module model switches or inserted privileged fixture grants replaced management operations. Database reads were used to corroborate persisted state and auditing.', '',
 '## Remaining release gates', '',
 '- **T28 FAIL / P1 QA-20261104-001:** activated menus disappear from the unfiltered management inventory on both stacks; explicit `is_active=true` returns them.',
 '- **T37 BLOCKED:** remote CI has no real-stack browser E2E job/evidence. The initial local Post test timing failure also remains tracked; controlled reruns passed.',
 '- QA Lead, Technical Lead and Product Owner decisions/signatures are pending. No approved exceptions were supplied.',
 '- Azure DevOps attachment/linking and issue closure remain pending. No authenticated issue target was provided. Do not close P2-QA-GATE-001 or approve Sprint 3 on this report.', '',
 'Detailed reproduction steps and remediation stories: [current defect register](defects-2026-11-04.md).', '',
 '## Execution evidence and limits', '',
 '- Real PostgreSQL migrations ran on new QA volumes and the existing database. Twelve services were checked in each stack. Existing developer volumes were never deleted. QA containers were removed; dedicated QA volumes remain available for investigation.',
 '- The continuous two-Site workflow covered Organization → Site → Domain → Modules → role/content assignments → Pages/Posts/Menus → separate author/reviewer/publisher → host-based public delivery → isolation → disable → audit. Working-draft editing preserved the public Page until approved publication.',
 '- Real realm-role escalation, cross-Site reads/writes, unsafe links, stored script input, anonymous writes and altered/expired tokens were checked. Module edits/public navigation were blocked while disabled; retained authorized Menu reads are expected.',
 '- Simultaneous mutating Menu reorders with one ETag returned 200 and 409 in both environments; descendant-parent moves returned typed invalid_tree. Original invalid QA assertions (disabled Menu reads; a no-op reorder) remain in JSON with explicit exclusion reasons, rather than being relabeled.',
 '- The first fresh browser run overlapped module mutation probes and lost navigation during a client transition; its three responsive timeouts/screenshots are retained. A subsequent public browser run with no concurrent module toggles passed all seven checks. This is an execution-control correction, not an approved product exception.',
 '- Initial restart probes ran before readiness or used the wrong Host header; they are not persistence failures. The final upgraded-environment check waited for readiness and retrieved the same organization and both Site ownership records through authenticated HTTP after restoration.',
 '- Backend: 647 passed, 1 skipped in the main run; both supplementary documentation checks passed with their documentation available. Frontend API client: 157 passed; UI: 86 passed; Admin initial 304 passed/1 failed, focused rerun 10 passed, full serial rerun 305 passed. All five typecheck tasks and both production builds passed. The first failed run is retained.',
 '- OpenAPI: 81 paths, validation without warnings, exact semantic match to the committed schema. Actual schema/Swagger/ReDoc requests returned 200. Production documentation policy is covered by backend regression.',
 '- Edge exercised actual QA hostnames (browser DNS mapping only), both public Sites, Post isolation, navigation, mobile/tablet/desktop layouts and keyboard controls. Fully loaded fresh admin permissions were visually inspected. This is targeted responsive/keyboard coverage, not a full accessibility certification.', '',
 '## Remote CI', '',
 '- [GitHub Actions — successful, matching full SHA](https://github.com/uog-website-dev/UoG-Website/actions/runs/41673728568). Executed November 3; queried/downloaded November 4. Existing same-SHA CI is not relabeled as a new CI execution. Metadata and backend/schema artifacts are in the evidence directory. Neither pipeline definition proves real-stack E2E.',
 '- The November 3 report links Azure build 66. It was not independently authenticated in this run and is not counted as newly verified CI evidence.', '',
 '## All 38 cases', '',
 'Every CSV/JSON row contains full build, date, tester, expected/actual result, status, evidence paths, defect references and exception status. Paths are relative to the evidence directory linked below.', '',
 '| Case | Status | Expected | Defect |', '| --- | --- | --- | --- |',
]
lines += [f"| {row['test_id']} | {row['status']} | {row['expected']} | {row['defects'] or '—'} |" for row in rows]
lines += ['', '## Cleanup and decisions', '',
 'Each run disabled all six dedicated Keycloak accounts and terminated sessions, revoked seven temporary database grants, removed six CMS bindings and deleted two private session files. Global module flags were restored via the management API before identity cleanup. Organization development writes are restored to False. Synthetic QA content/history remains intentionally identifiable by its run prefix; existing institutional records and developer volumes remain present.', '',
 '| Stakeholder | Name / signed record | Decision | Date |', '| --- | --- | --- | --- |',
 '| QA Lead | Pending | Pending | Pending |', '| Technical Lead | Pending | Pending | Pending |', '| Product Owner | Pending | Pending | Pending |', '',
 'No commit, push, issue closure or stakeholder approval was performed. No exceptions were approved.', '',
 '[38-case CSV](results-2026-11-04.csv) · [full results JSON](results-2026-11-04.json) · [evidence](evidence/rerun-2026-11-04/) · [defects and stories](defects-2026-11-04.md)', '']
(OUT / 'report-2026-11-04.md').write_text('\n'.join(lines), encoding='utf-8')

# Normalize text encoding/control sequences, preserving all observations.
for path in E.rglob('*'):
    if path.is_file() and path.suffix in {'.log', '.txt', '.json', '.yaml'}:
        content = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', read(path))
        path.write_text(content, encoding='utf-8')
patterns = {'JWT': r'eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}',
            'Bearer credential': r'Bearer\s+eyJ[A-Za-z0-9_-]{10,}',
            'Cookie header value': r'(?im)^\s*(?:set-cookie|cookie):\s*[^\s]+'}
findings = []
for path in E.rglob('*'):
    if path.is_file() and path.suffix != '.png':
        content = read(path)
        findings += [{'path': str(path.relative_to(E)), 'pattern': name} for name, pattern in patterns.items() if re.search(pattern, content)]
scan = {'status': 'PASS' if not findings else 'FAIL', 'findings': findings,
        'scope': 'All textual evidence scanned for JWTs, bearer credentials and cookie header values; screenshots visually inspected; credential inputs/configurations were never written to evidence.'}
(E / 'secret-scan.json').write_text(json.dumps(scan, indent=2), encoding='utf-8')
assert not findings, 'Sensitive evidence pattern detected; inspect without printing matching values.'
manifest = {str(path.relative_to(OUT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in E.rglob('*') if path.is_file()}
for name in ('report-2026-11-04.md', 'results-2026-11-04.csv', 'results-2026-11-04.json', 'defects-2026-11-04.md'):
    manifest[name] = hashlib.sha256((OUT / name).read_bytes()).hexdigest()
for name in ('qa-gate-acceptance.ps1', 'qa-gate-rerun.py', 'qa-gate-browser.cjs', 'qa-gate-cleanup.py',
             'qa-gate-expiry.py', 'qa-gate-probes.py', 'qa-gate-persistence.py', 'qa-gate-wait.py', 'qa-gate-final-report.py'):
    manifest['../../../scripts/' + name] = hashlib.sha256((ROOT / 'scripts' / name).read_bytes()).hexdigest()
(OUT / 'manifest-2026-11-04.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps({'counts': counts, 'recommendation': 'NO-GO', 'evidence_files': len(manifest), 'secret_scan': scan['status']}))
