# P0-PERF-006 release evidence ? 16 November 2026

Implementation and automated checks pass. Performance budgets and measurement methodology remain **PROPOSED** pending product/QA approval; this is not a signed acceptance or external review. No schema migration is required.

## Result

The dashboard uses one authorized summary request instead of six Page reads, four Post reads and separate menu/media/user list reads. Database aggregates return counts without content bodies. Recent activity loads independently; a slow or failed secondary request leaves essentials visible. Redis summaries are partitioned by Site, user and live authorization/module fingerprint, with post-commit generation invalidation, bounded TTL and visible freshness. Current permission/module checks precede cache access.

| Production scenario | p50 | p95 | Samples |
| --- | ---: | ---: | ---: |
| Dashboard usable | 121 ms | 438 ms | 31 |
| Dashboard summary API | 27 ms | 36 ms | 20 |
| Cold Site switch | 340 ms | 438 ms | 10 |
| Warm Site switch | 111 ms | 133 ms | 10 |
| Cached section return | 80 ms | 95 ms | 10 |
| Cached section transition | 77 ms | 101 ms | 10 |

All 151 samples completed without failures and all API probes have correlated Django spans. Cold switching fell from median 20 Django requests / 381 SQL queries to 4 / 50; warm returns retain zero Django requests. Dashboard p95 improved from 956 ms in PERF-005 to 438 ms. Sequential local runs and small samples are not proof of causal attribution for every timing change. First uncached section navigation p95 was 724 ms; it is distinct from the cached-transition budget.

[Production samples](production/results.json), [correlated traces](production/traces.jsonl), [baseline comparison](comparison.md), [build milestones](production/build-events.txt), [built-source verification](build-source.json).

## Functional and security checks

[Real-browser checks](browser-dashboard.json) reconcile two Sites against independent source queries and verify Redis hits, one essential plus one secondary action, held/failed activity with independent retry, slow-summary recovery and POSTS disable/isolation. The controlled module change was restored. API tests cover empty enabled Sites, unavailable aggregates, unavailable cache, foreign/unknown IDs, denied CMS reads, inactive/expired/revoked authorization, rollback and post-commit invalidation. Component tests cover cached refresh failures, denied-response hiding and invalidating protected section caches when live summary scope narrows.

- [Backend 48 passing](backend.xml), including [15 dashboard cases](dashboard-tests.xml); overlapping suites are not additive.
- [Frontend full suite: 624 passing](full.xml), before the final scope-change guard.
- [Final focused frontend: 79 passing](focused-final.xml), plus TypeScript verification after that guard.
- [Final focused log](focused-final.txt), [backend checks/no migrations](backend-checks.txt), [metrics harness tests](metrics-tests.txt), [validation summary](validation-summary.json).
- OpenAPI generation validated without warnings; the [baseline](../../../api/openapi.yaml) and documentation contract tests include both endpoints. Empty openapi.txt reflects a successful silent command.

## Environment and reproducibility

Production Next.js 15.5.28 / Node 22.23.3, Django with two synchronous Gunicorn workers, real Redis and existing PostgreSQL, headless Edge 157.0.4341.46 at 1440?1000, unthrottled loopback. Windows 11 / i7-1355U / 16 GB host; [Docker resources](docker-environment.json). Twenty-one managed Sites each contain 40 Pages, 100 Posts, 80 private media assets, four menus/48 items, five categories and ten tags. The generated account had only direct Site Administrator assignments; [profile](principal-profile.json). No test/build/fault injection overlapped final timing.

Follow the [implementation/reproduction guide](../../../performance/P0-PERF-006.md), using the production perf stack and `scripts/perf/run.ps1 -DashboardProbes`. The dashboard-check.cjs harness receives private session configuration through stdin. Earlier production-before-scope-guard is retained as superseded diagnostic evidence; production/ is the final source-verified run.

## Freshness, deployment and remaining approval

Default server TTL and visible client refresh interval are 15 seconds. Standard model writes invalidate after commit; bulk SQL and other-user activation changes rely on bounded freshness. A continuously mounted view normally refreshes within about 30 seconds; remount timing gives a conservative default 45 seconds plus network time (90 seconds at maximum server TTL). Live permission/module gates still run for every server read. Background tabs revalidate on return. These are documented freshness bounds, not instantaneous aggregate consistency guarantees.

Rebuild backend and admin services and restart backend workers so signal registration and settings are loaded; no migration. Production benchmark services are stopped after verification. The generated login is disabled, memberships revoked and private session removed; the representative dataset is retained for repeatability. [Cleanup](cleanup.json), [credential scan](secret-scan.json). QA sign-off, external review and Issue/PR attachments remain pending.
