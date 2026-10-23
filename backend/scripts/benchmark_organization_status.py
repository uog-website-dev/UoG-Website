"""Measure the status/code index using temporary PostgreSQL data only.

Run after migrations: python scripts/benchmark_organization_status.py
The query mirrors the admin's status filter and code ordering. Results are
local measurements, not a promise about production cardinality or timings.
"""
import json
import os
from pathlib import Path
from statistics import median
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from django.db import connection, transaction


def measure(cursor):
    times = []
    plan = None
    for _ in range(5):
        cursor.execute("""
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            SELECT id, code FROM org_unit_status_bench
            WHERE status = 'INACTIVE' ORDER BY code LIMIT 50
        """)
        result = cursor.fetchone()[0][0]
        times.append(result["Execution Time"])
        plan = result["Plan"]
    return {"median_execution_ms": median(times), "plan": plan}


def main():
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("""
            CREATE TEMP TABLE org_unit_status_bench
            (LIKE organizations_organizationunit INCLUDING DEFAULTS) ON COMMIT DROP
        """)
        cursor.execute("""
            INSERT INTO org_unit_status_bench
                (id, code, name, short_name, organization_type_id, parent_id,
                 description, status, metadata, created_at, updated_at)
            SELECT n, 'BENCH_' || lpad(n::text, 6, '0'), 'Benchmark unit ' || n,
                '', 1, 1, '', CASE WHEN n % 100 = 0 THEN 'INACTIVE' ELSE 'ACTIVE' END,
                '{}'::jsonb, now(), now()
            FROM generate_series(1, 100000) AS n
        """)
        cursor.execute("CREATE UNIQUE INDEX bench_code_idx ON org_unit_status_bench (code)")
        cursor.execute("CREATE INDEX bench_parent_idx ON org_unit_status_bench (parent_id)")
        cursor.execute("CREATE INDEX bench_type_idx ON org_unit_status_bench (organization_type_id)")
        cursor.execute("ANALYZE org_unit_status_bench")
        before = measure(cursor)
        cursor.execute("CREATE INDEX bench_status_code_idx ON org_unit_status_bench (status, code)")
        cursor.execute("ANALYZE org_unit_status_bench")
        after = measure(cursor)
        print(json.dumps({
            "rows": 100000, "inactive_percent": 1, "limit": 50, "runs_per_case": 5,
            "without_status_index": before, "with_status_code_index": after,
        }, indent=2))


if __name__ == "__main__":
    main()
