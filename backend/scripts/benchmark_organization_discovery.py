"""Measure actual discovery querysets on 10,000 session-local rows.

Run: python scripts/benchmark_organization_discovery.py
The temporary table shadows the unit table on this connection only, copies
its current CHECK constraints/indexes, and drops on commit. Persistent rows and
sequences are untouched. Timings are local warm-cache measurements.
"""
import json
import os
from pathlib import Path
from statistics import median
import sys
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from django.db import connection, transaction
from apps.organizations.api.discovery import OrganizationDiscoverySerializer
from apps.organizations.models import OrganizationType, OrganizationUnit
from apps.organizations.selectors.discovery import discover_organizations


def plan_nodes(plan):
    yield plan
    for child in plan.get("Plans", []):
        yield from plan_nodes(child)


def main():
    kinds = dict(OrganizationType.objects.values_list("code", "pk"))
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("""
            CREATE TEMP TABLE organizations_organizationunit (
                LIKE public.organizations_organizationunit
                INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES
            ) ON COMMIT DROP
        """)
        cursor.execute("""
            INSERT INTO organizations_organizationunit
                (id, code, name, short_name, organization_type_id, parent_id,
                 description, status, metadata, created_at, updated_at)
            SELECT n, 'UNIT_' || lpad(n::text, 6, '0'),
                CASE WHEN n %% 10 = 0 THEN 'Informatics unit ' ELSE 'General unit ' END || n,
                '', CASE WHEN n = 1 THEN %s WHEN n %% 3 = 0 THEN %s ELSE %s END,
                CASE WHEN n = 1 THEN NULL WHEN n %% 2 = 0 THEN 1 ELSE 2 END,
                '', CASE WHEN n %% 11 = 0 THEN 'ARCHIVED' WHEN n %% 7 = 0 THEN 'INACTIVE' ELSE 'ACTIVE' END,
                '{}'::jsonb, now(), now()
            FROM generate_series(1, 10000) AS n
        """, [kinds["UNIVERSITY"], kinds["COLLEGE"], kinds["DEPARTMENT"]])
        cursor.execute("ANALYZE organizations_organizationunit")
        results = {}
        for name, query in {
            "code": {"code": "UNIT_005000"},
            "search": {"search": "informatics"},
            "combined": {"search": "informatics", "type": "COLLEGE", "parent": "1", "status": "ACTIVE", "ordering": "name"},
            "late_page": {"status": "ACTIVE", "ordering": "name"},
        }.items():
            serializer = OrganizationDiscoverySerializer(data=query)
            serializer.is_valid(raise_exception=True)
            queryset = discover_organizations(OrganizationUnit.objects.select_related("organization_type"), serializer.validated_data)
            page = queryset[1000:1020] if name == "late_page" else queryset[:20]
            times = []
            for _ in range(5):
                started = perf_counter()
                count = queryset.count()
                returned = len(list(page.all()))
                times.append((perf_counter() - started) * 1000)
            plan = json.loads(page.explain(analyze=True, buffers=True, format="JSON"))[0]
            results[name] = {
                "count": count, "returned": returned,
                "median_count_and_page_ms": round(median(times), 3),
                "page_execution_ms": plan["Execution Time"],
                "plan_nodes": sorted({node["Node Type"] for node in plan_nodes(plan["Plan"])}),
                "indexes": sorted({node["Index Name"] for node in plan_nodes(plan["Plan"]) if "Index Name" in node}),
            }
        print(json.dumps({"rows": 10000, "page_size": 20, "runs_per_case": 5, "results": results}, indent=2))


if __name__ == "__main__":
    main()
