"""Compare completed PERF-007 HTTP samples using nearest-rank percentiles."""
import json
import sys
from pathlib import Path


def read(path):
    data = json.loads(Path(path).read_text(encoding='utf-8-sig'))
    assert len(data['samples']) == 420 and not data['failures']
    assert all(row['request_id'] and row['sql_count'] > 0 for row in data['samples'])
    assert all(sum(row['kind'] == kind for row in data['samples']) == 60 for kind in data['summary'])
    return data


before, after = map(read, sys.argv[1:3])
assert before['method'] == after['method']
print('# P0-PERF-007 concurrent HTTP comparison\n')
print('Budgets and methodology remain **PROPOSED**, pending product/QA approval. '
      'Four concurrent clients, 60 reads per endpoint, 21 Sites and two synchronous Gunicorn workers. '
      'Nearest-rank percentiles; durations include queueing, transport and response parsing.\n')
print('| Endpoint | Before p50 / p95 ms | After p50 / p95 ms | Median SQL before / after | Proposed p95 budget | Result |')
print('| --- | ---: | ---: | ---: | ---: | --- |')
for kind, final in after['summary'].items():
    initial = before['summary'][kind]
    budget = 400 if kind in {'pages', 'posts', 'menus', 'media'} else 500
    a, b = initial['duration_ms'], final['duration_ms']
    print(f"| {kind} | {a['p50']:.1f} / {a['p95']:.1f} | {b['p50']:.1f} / {b['p95']:.1f} | "
          f"{initial['sql_count']['p50']} / {final['sql_count']['p50']} | {budget} ms | "
          f"{'PASS' if b['p95'] <= budget else 'FOLLOW-UP REQUIRED'} |")
print('\nThese sequential local runs do not establish production capacity. Retained '
      'database buffers, login/JWKS warming and background host activity can affect timing. '
      'Raw samples include SQL duration and body byte counts. Dashboard samples mix safe '
      'Redis hits and misses and retain the cache-hit field for analysis. No shared '
      'authorization caching was added. Existing full CMS list payloads are preserved '
      'for compatibility; a versioned compact representation is a possible follow-up.')
