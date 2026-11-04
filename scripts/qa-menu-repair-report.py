"""Report the repaired working tree from new acceptance evidence only."""
import csv
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs/qa/P2-QA-GATE-001'
E = OUT / 'evidence/menu-repair-2026-11-04'
def read(path):
    raw = path.read_bytes()
    return raw.decode('utf-16') if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else raw.decode('utf-8-sig')
def data(name):
    return json.loads(read(E / name))
def write(path, value):
    path.write_text(value, encoding='utf-8')

for path in E.rglob('*'):
    if path.is_file() and path.suffix in {'.log', '.json', '.txt', '.patch', '.yaml'}:
        write(path, re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', read(path)))
runs = {name: data(f'{name}/api-results.json') for name in ('existing', 'fresh')}
build = runs['existing']['state']['build']
assert '+worktree.' in build
assert all(v['state']['build'] == build and v['state']['completed_http_workflow'] for v in runs.values())
browser = {name: data(f'{name}/browser-results.json')['results'] for name in runs}
assert all({row['id'] for row in rows} >= {'T28-browser', 'T13-browser', 'T12-logout'} for rows in browser.values())
backend = ET.parse(E / 'backend.junit.xml').getroot().find('testsuite')
assert backend is not None and backend.attrib['failures'] == '0' and backend.attrib['errors'] == '0'
assert backend.attrib['skipped'] == '0'
assert all(data(f'{name}/cleanup.json')['disabled_qa_keycloak_users'] == 6 for name in runs)
assert all(data(f'{name}/token-expiry.json')['status'] == 'PASS' for name in runs)
assert set(read(E / 'developer-volumes-before.txt').splitlines()) <= set(read(E / 'developer-volumes-after.txt').splitlines())
# Reuse expected descriptions only; historical statuses and actuals are ignored.
expected = {row['test_id']: row['expected'] for row in json.loads(read(OUT / 'results-2026-11-04.json'))['cases']}
manual = {
 'T01': ('PASS', 'Twelve required services healthy on upgraded and isolated fresh stacks; developer stack restored. Celery Beat has no configured healthcheck.', 'existing/services.txt;fresh/services.txt;services-restored.txt'),
 'T02': ('PASS', 'Existing migration/drift checks passed. New QA volumes applied the complete migration chain and the fresh workflow succeeded. No schema migration is required for this serializer fix.', 'platform-checks.log;fresh/deployment.log;fresh/migration-check.log'),
 'T31': ('PASS', 'Real Edge requests rendered own Page/Post snapshots on both QA hostnames and rejected foreign content.', 'existing/browser-results.json;fresh/browser-results.json'),
 'T32': ('PASS', 'Actual mobile, tablet and desktop browser/keyboard checks passed at 390x844, 768x1024 and 1440x1000. Screenshots retained.', 'existing/browser-results.json;fresh/browser-results.json'),
 'T37': ('BLOCKED', f"Final backend: {backend.attrib['tests']} passed, zero failures/skips. Frontend API client 157, UI 86 and Admin 305 tests passed; all typechecks and both production builds passed. New remote CI cannot test this uncommitted repair; remote real-stack E2E coverage also remains outstanding.", 'backend.junit.xml;frontend.log;typecheck.log;frontend-build.log;build.json'),
 'T38': ('PASS', 'A new isolated project/volumes repeated the complete workflow, repaired menu/item inventory and browser editing. QA containers removed; developer volumes preserved.', 'fresh-deployment.log;fresh/api-results.json;fresh/browser-results.json;fresh/cleanup.json;restore-existing.log'),
}
rows = []
for n in range(1, 39):
    case = f'T{n:02}'
    if case in manual:
        status, actual, evidence = manual[case]
    else:
        findings = [(name, item) for name, v in runs.items() for item in v['results'].get(case, [])]
        assert findings, case
        status = 'PASS' if all(item['pass'] for _, item in findings) else 'FAIL'
        actual = ' '.join(f"{name}: {item['actual']}" for name, item in findings)
        evidence = 'existing/api-results.json;existing/http-transcript.json;fresh/api-results.json;fresh/http-transcript.json'
    related = [(name, row) for name, checks in browser.items() for row in checks if row['id'].split('-')[0] == case]
    if related:
        if any(row['status'] != 'PASS' for _, row in related): status = 'FAIL'
        actual += ' ' + ' '.join(f"{name} browser: {row['actual']}" for name, row in related)
        evidence += ';existing/browser-results.json;fresh/browser-results.json'
    rows.append({'test_id': case, 'execution_date': '2026-11-04', 'tester': 'Codex automated real-HTTP/Edge QA and artifact inspection',
        'build': build, 'expected': expected[case], 'actual': actual, 'status': status,
        'evidence': evidence, 'defects': 'QA-20261104-002' if case == 'T37' else '',
        'approved_exception': 'None'})
counts = dict(Counter(row['status'] for row in rows))
summary = {'issue': 'P2-QA-GATE-001', 'build': build, 'counts': counts, 'cases': rows,
    'menu_defect': 'QA-20261104-001 implemented and verified locally; review/commit/CI pending',
    'stakeholder_signatures': 'Pending — none synthesized', 'azure_attachment': 'Pending — no authenticated issue target supplied',
    'technical_recommendation': 'NO-GO for formal Sprint 3 approval until remote CI/E2E and genuine stakeholder decisions are recorded'}
write(OUT / 'results-menu-repair-2026-11-04.json', json.dumps(summary, indent=2))
with (OUT / 'results-menu-repair-2026-11-04.csv').open('w', encoding='utf-8-sig', newline='') as stream:
    writer = csv.DictWriter(stream, fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)
lines = ['# Menu inventory repair and acceptance rerun — 4 November 2026', '',
    '**QA-20261104-001 is fixed and verified locally.** Menu and MenuItem lists now preserve an omitted `is_active` filter. Explicit filters, validation, pagination, authorization and module gates are unchanged.', '',
    f'Application base commit: `{build.split("+")[0]}`. Tested working tree: `{build}`. The repair is uncommitted, as requested; no commit/push/issue closure or stakeholder approval was performed. `repair.patch` and file hashes identify the tested changes.', '',
    f'**38-case local rerun: {counts}.** The full technical workflow passed on the upgraded stack and an independently migrated fresh stack. Formal Sprint 3 readiness remains **NO-GO/pending** because remote CI/E2E for the repair, issue attachment and genuine stakeholder decisions are outstanding. Historical reports and failures remain separate.', '',
    '## Change and verification', '',
    '- The API rejected repeated query parameters as before, then converted QueryDict to a plain mapping before serializer validation. DRF no longer treats omitted query booleans as unchecked HTML checkboxes. The shared parser fixes both Menu and MenuItem inventories.',
    '- Real Django HTTP regression tests first reproduced both defects. The final 22-test Menu API suite passed, covering both record states, omitted/true/false filters, empty/malformed/repeated values, deterministic pagination, live-menu editing, scope/permission/module gates and concurrency.',
    f"- The final complete backend suite passed {backend.attrib['tests']} tests with zero failures/skips. Frontend API client 157, UI 86 and Admin 305 tests passed; typechecks and both production builds passed. No database migration is required.",
    '- OpenAPI is regenerated and validated; query-filter descriptions explicitly state that omission includes both states. The generated schema matches `docs/api/openapi.yaml`.',
    '- Protected real-Keycloak HTTP calls verified mixed-state menu/item inventories, explicit filters and typed invalid-query errors. Simultaneous mutating reorders returned 200/409; cycle attempts were rejected. Cross-Site reads/writes remained denied.',
    '- Edge showed active header and inactive footer together on both stacks. The activated header was edited through the real admin UI, reloaded to verify persistence, then restored through the UI. Screenshot: `existing/admin-menus-active-inactive.png` and the fresh equivalent.',
    '- Both continuous workflows used actual Organization, Site, Domain, Module, assignment, content, review, publication, public-rendering, disable and audit operations. No model switches or privileged fixture grants replaced these operations. Real expired tokens returned 401.', '',
    '## Execution corrections retained in evidence', '',
    'An initial setup request ran before backend readiness and returned 502. Its single orphan QA identity was discovered by its exact recorded run prefix and disabled; `orphan-cleanup.json` records this. The final workflow waits for readiness. An early backend snapshot used an intermediate documentation annotation/contract assertion, failed that assertion and was interrupted; a subsequent stale snapshot was also interrupted. Those logs/XML remain separate from the final passing suite. OpenAPI omission of `required` means false; the final assertion checks that correctly. No assertion was removed to obtain the final pass.', '',
    '## Case results', '', '| Case | Status | Expected |', '| --- | --- | --- |']
lines += [f"| {row['test_id']} | {row['status']} | {row['expected']} |" for row in rows]
lines += ['', '## Cleanup and outstanding acceptance', '',
    'Each successful run disabled six dedicated Keycloak accounts, terminated sessions, revoked temporary grants and removed private session files. The initial orphan account was also disabled. Original module flags and organization development-write settings were restored. Dedicated QA containers were removed; their QA volumes and identifiable synthetic content/history remain available for inspection. Existing developer volumes were never deleted.', '',
    'The original successful GitHub CI run on the base commit is not evidence for this working-tree repair. A reviewed repair commit and passing remote backend/frontend/schema/E2E jobs must be linked before formal closure. QA Lead, Technical Lead and Product Owner names, signed decisions and dates remain pending; no exceptions or signatures were invented.', '',
    '[38-case CSV](results-menu-repair-2026-11-04.csv) · [full results](results-menu-repair-2026-11-04.json) · [evidence](evidence/menu-repair-2026-11-04/)', '']
write(OUT / 'report-menu-repair-2026-11-04.md', '\n'.join(lines))
findings = []
for path in E.rglob('*'):
    if path.is_file() and path.suffix != '.png':
        content = read(path)
        if re.search(r'eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}|(?im:^\s*(?:set-cookie|cookie):\s*\S+)', content):
            findings.append(str(path.relative_to(E)))
assert not findings, 'Sensitive pattern found; inspect paths without printing matched values: ' + str(findings)
write(E / 'secret-scan.json', json.dumps({'status': 'PASS', 'findings': [], 'scope': 'All textual evidence checked for JWTs and cookie header values; screenshots inspected; private credentials/configurations excluded.'}, indent=2))
files = [p for p in E.rglob('*') if p.is_file()]
files += [OUT / f'{prefix}-menu-repair-2026-11-04.{suffix}' for prefix, suffix in (('report','md'),('results','csv'),('results','json'))]
manifest = {str(p.relative_to(OUT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
write(OUT / 'manifest-menu-repair-2026-11-04.json', json.dumps(manifest, indent=2))
with zipfile.ZipFile(OUT / 'menu-repair-evidence-2026-11-04.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for p in files: archive.write(p, p.relative_to(OUT))
    archive.write(OUT / 'manifest-menu-repair-2026-11-04.json', 'manifest-menu-repair-2026-11-04.json')
print(json.dumps({'counts': counts, 'menu_repair': 'verified locally', 'formal_approval': 'pending', 'files': len(files)}))
