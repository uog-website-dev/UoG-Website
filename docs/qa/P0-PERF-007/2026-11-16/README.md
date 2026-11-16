# P0-PERF-007 — API query and concurrent-load evidence

Implementation and automated verification pass. Measurement methodology and
budgets remain **PROPOSED** pending product/QA approval. No schema migration or
frontend/API contract change is required. This report is not a signed release
approval or production capacity certification.

## Results

Same managed dataset and generated Site Administrator: 21 Sites, each with
40 Pages, 100 Posts, 80 private media assets, four menus/48 items, five categories
and ten tags. Before/after runs each made 420 successful real HTTP reads (60 per
endpoint) with four concurrent clients against two synchronous Gunicorn workers.
Real PostgreSQL, Redis and Keycloak bearer authentication were used. No build,
seed, regression tests or fault injection overlapped timed batches.

| Endpoint | Before p95 | After p95 | Median SQL before / after |
| --- | ---: | ---: | ---: |
| Workspace bootstrap | 167 ms | 39 ms | 10 / 10 |
| Site switcher | 112 ms | 44 ms | 10 / 10 |
| Pages | 1,325 ms | 84 ms | 153 / 18 |
| Posts | 1,668 ms | 180 ms | 190 / 18 |
| Menus | 410 ms | 64 ms | 24 / 18 |
| Media | 348 ms | 124 ms | 22 / 16 |
| Dashboard | 81 ms | 79 ms | 11 / 11 |

All measured endpoints meet the proposed p95 budgets: paginated lists ≤400 ms;
workspace/dashboard reads ≤500 ms. See [p50/p95 comparison](comparison.md),
[before samples](before-load.json) and [after samples](after-load.json).
Durations include queueing, transport, body reading and JSON parsing over the
Docker network. Bytes are response body bytes, not total wire transfer.
Sequential local runs and retained buffers can affect results; unchanged-query
endpoints such as bootstrap should not have their timing gains attributed solely
to the ORM changes. The large Page/Post SQL-count reduction is direct evidence.

The [in-process SQL baseline](before-profile.json) and
[final SQL/plans](after-profile.json) separately cover permissions, bootstrap,
discovery/search, CMS lists, status/recent filters, ready-image filtering and
dashboard cold/warm reads. Default 20-row Page/Post reads decreased from 143/186
queries to 14/14 without bearer-auth middleware overhead. These are SQL diagnostics,
not HTTP p95 estimates. First calls can include Python import/setup costs.

## Query and index review

[Plan inventory and decision](plan-review.json) records EXPLAIN ANALYZE/BUFFERS
results, relation/index names and per-query execution times. Plans omit literal
filters/output and profiles normalize SQL values. Existing Site ownership,
assignment liveness, taxonomy join, Menu sibling and snapshot version indexes
support the captured queries. Repeated ORM reads dominated the measured cost.
Small sequential scans are legitimate planner choices at this scale.

No additional index was justified, so there is no DDL build, migration lock or
rollback impact. Page/Post list bodies remain for existing client compatibility;
a versioned compact-list representation is a documented potential follow-up.
Discovery now selects only its four response columns. Existing pagination upper
bounds, ordering, tie-breakers, counts and strict/safe invalid-parameter behavior
are retained.

## Authorization, caching and regressions

The optimizations share workflow/homepage permission hints within one serializer
response, prefetch bounded list relations, resolve Post publication dates in a
scalar subquery and filter permission-bearing assignments in SQL. Site owner and
ancestor lookups are shared only within one permission evaluation. They do not
persist across requests or replace write authorization. No Redis permission or
draft cache was introduced; existing scoped dashboard caching and invalidation
remain covered.

[155 tests passed on a fresh test database](tests.xml), with
[final command output](final-tests.txt). Coverage includes:

- Constant query growth for 1 versus 20 Pages, Posts and Menus; deterministic,
  nonduplicated page boundaries and safe maximum sizes.
- Site-local workflow hints, live revocation after serialization, expiration,
  multiple roles and bounded organization ancestor checks.
- Existing canonical membership, inactive-user/role, Site isolation, module,
  workflow/self-approval, Post working-copy and Menu destination/publication tests.
- Workspace/dashboard regressions, mutation invalidation and OpenAPI/documentation
  contract checks.

The initial reused-database run passed 61 tests and failed one existing workflow
test during fixture setup because its seeded PAGES module was absent; see
[initial diagnostic](initial-reused-db-tests.txt). Recreating the test database
resolved that fixture state, and all 155 expanded regressions passed. No production
authorization or module policy was relaxed to make the tests pass.

[Django system/migration checks](checks.txt) pass with no model changes.
[Validation summary](validation-summary.json), [runtime source hashes](runtime-source.json)
and [source manifest](source-manifest.json) identify the verified implementation.
No frontend code changed, so a frontend build/browser workflow rerun was not needed
for these backend-only optimizations.

## Environment, reproduction and cleanup

Windows 11 host, Intel i7-1355U, 16 GB RAM; [Docker resources/version](docker-environment.json).
Isolated performance backend uses DEBUG false, PostgreSQL 16, the existing Redis
service and two synchronous Gunicorn workers. The management-shell SQL profiler
uses DEBUG true only to enforce its development-fixture guard. The load driver
uses real HTTP and bearer authentication without forced authentication.
See [principal scope](principal-profile.json).

Follow the [implementation/reproduction guide](../../../performance/P0-PERF-007.md).
Run the same `api-load.py` script before/after; use `compare-api.py` to regenerate
the comparison. Private stdin configuration/session values must never be written
to evidence. The generated account has been disabled, 21 memberships revoked and
the private session removed; [cleanup result](cleanup.json). The isolated perf
backend is stopped. Managed data is retained for reproducibility.
[Credential scan](secret-scan.json) found no recorded credentials or JWTs.

Deployment: rebuild/restart backend services and workers. No database migration
or frontend rebuild is introduced by this story. Product/QA methodology approval,
external review and linking the PR/evidence to the Issue remain pending.
