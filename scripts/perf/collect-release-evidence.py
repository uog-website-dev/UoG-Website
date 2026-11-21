"""Collect redacted PERF-010 artifacts into a hash-bound review manifest.

Does not approve a release. Missing evidence yields FAIL and a non-zero exit.
"""
import hashlib
import json
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

root = Path(sys.argv[1]).resolve()
artifacts = {}
errors = []
resolutions = []

def read(name):
    p = root / name
    raw = p.read_bytes()
    artifacts[name] = hashlib.sha256(raw).hexdigest()
    return raw.decode('utf-8-sig')

def document(name):
    return json.loads(read(name))

def checked(name, action):
    try:
        ok = bool(action())
    except (OSError, ValueError, KeyError, ET.ParseError):
        ok = False
    if not ok:
        errors.append(name + ': missing or failed evidence')
    return 'PASS' if ok else 'FAIL'

def junit(name, rerun=None):
    r = ET.fromstring(read(name))
    suites = [r] if r.tag == 'testsuite' else list(r.iter('testsuite'))
    if not suites or sum(int(s.get('tests', 0)) for s in suites) == 0:
        return False
    failed = [c for c in r.iter('testcase') if c.find('failure') is not None or c.find('error') is not None]
    if not failed:
        return True
    if not rerun:
        return False
    latest = ET.fromstring(read(rerun))
    if any(c.find('failure') is not None or c.find('error') is not None for c in latest.iter('testcase')):
        return False
    passed = {(c.get('classname'), c.get('name')) for c in latest.iter('testcase') if c.find('failure') is None and c.find('error') is None and c.find('skipped') is None}
    resolved = all((c.get('classname'), c.get('name')) in passed for c in failed)
    if resolved:
        resolutions.extend({'test': c.get('classname') + '::' + c.get('name'), 'rerun': rerun} for c in failed)
    return resolved

checks = {}
browser_files = ['workspace', 'switch', 'sections', 'cache', 'dashboard', 'browser-reads', 'recovery', 'isolation']
checks['browser'] = checked('browser', lambda: all(document('browser-final/' + f + '.json')['status'] == 'PASS' for f in browser_files))
checks['backend'] = checked('backend', lambda: junit('full-backend.xml', 'documentation.xml') and junit('minio.xml'))
checks['frontend'] = checked('frontend', lambda: junit('frontend.xml') and document('shared-frontend.json')['status'] == 'PASS')
checks['build'] = checked('build', lambda: document('bundles.json')['budget_violations'] == [] and document('public-build.json')['status'] == 'PASS')
def load_ok():
    data = document('api-load.json')
    if data['failures'] or data['dashboard_sites_reconciled'] < 21:
        return False
    # Same proposed API ceilings as PERF-001; no hidden relaxation under load.
    limits = {'bootstrap': 500, 'switcher': 500, 'pages': 400, 'posts': 400, 'menus': 400, 'media': 400, 'dashboard': 500}
    for kind, limit in limits.items():
        rows = [s for s in data['samples'] if s['kind'] == kind]
        values = sorted(s['duration_ms'] for s in rows)
        if len(values) < 60 or not all(math.isfinite(v) and v >= 0 for v in values) or values[math.ceil(len(values) * .95)-1] > limit:
            return False
    return True

checks['api_load'] = checked('api_load', load_ok)
checks['service_health'] = checked('service_health', lambda: document('service-health.json')['status'] == 'PASS')
checks['openapi'] = checked('openapi', lambda: document('openapi.json')['status'] == 'PASS')
try:
    result = document('final/production/results.json')
    commit = result['metadata']['source']['commit']
except (OSError, ValueError, KeyError):
    commit = None
    errors.append('benchmark missing')
report = {'reference': 'P0-PERF-010', 'status': 'FAIL' if errors else 'PASS', 'commit': commit, 'checks': checks, 'resolved_failures': resolutions, 'artifacts_sha256': artifacts, 'errors': errors, 'approval': 'NOT_GRANTED; QA and Security must review and bind their approval to this file hash'}
(root / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'status': report['status'], 'checks': checks, 'errors': errors}))
sys.exit(bool(errors))
