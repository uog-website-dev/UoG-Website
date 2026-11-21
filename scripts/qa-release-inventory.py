"""Refresh committed story IDs/PR merge references; preserve manual review mappings."""
import argparse
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--output', default='docs/qa/P4-QA-003/2026-11-21/story-inventory.json')
args = parser.parse_args()
target = ROOT / args.output
old = json.loads(target.read_text(encoding='utf-8-sig')) if target.exists() else {}
records = {r['id']: r for r in old.get('stories', [])}
history = subprocess.check_output(['git', 'log', 'HEAD', '--format=%H%x09%s'], cwd=ROOT, text=True)
ids = set(re.findall(r'P4-[A-Z]+-\d{3}', history))
if re.search(r'P4-POST-001.*(?:to|ot)[ -]*007', history):
    ids.update(f'P4-POST-{i:03}' for i in range(1, 8))
rows = []
for story in sorted(ids):
    matches = [line for line in history.splitlines() if story in line]
    if not matches and story.startswith('P4-POST-'):
        matches = [line for line in history.splitlines() if 'P4-POST-001' in line and ('to 007' in line or '-ot-007' in line)]
    prs = sorted({int(number) for line in matches for number in re.findall(r'Merge pull request #(\d+)', line)})
    row = records.get(story, {'id': story, 'review': None, 'tests': None, 'qa_evidence': None})
    row.update(commits=[line.split('\t')[0] for line in matches],
               pr=row.get('pr') or [f'https://github.com/uog-website-dev/UoG-Website/pull/{n}' for n in prs] or None,
               pr_basis='Local Git merge metadata/manual supplied links; remote review approval not inferred')
    rows.append(row)
result = {'source': 'Committed HEAD identifiers, expanded Post range; reconcile against the authoritative sprint/Issue export',
          'source_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
          'stories': rows, 'needs_reconciliation': old.get('needs_reconciliation', [])}
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(result, indent=2), encoding='utf-8')
print(f'{len(rows)} committed identifiers; manual reviews/test/QA mappings are not fabricated')
