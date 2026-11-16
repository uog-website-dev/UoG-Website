# P0-PERF-007 — bounded API query cost

The API keeps its existing authentication, Site scope, module gates, workflow
rules and response contracts. This change addresses measured ORM fan-out.
Performance budgets remain proposed until product/QA accepts the methodology.

## Measured paths and changes

`scripts/perf/api-profile.py` exercises workspace bootstrap, searchable Site
discovery, Pages, Posts, Menus, Media, dashboard and effective permissions against
the managed PERF001 dataset. It records five in-process reads, SQL counts/time,
normalized query shapes and PostgreSQL EXPLAIN ANALYZE/BUFFERS plans. Plan output
omits literal filters and row contents. This is a SQL diagnostic, not an HTTP
latency measurement. The first request can include Python import/setup cost.

The initial 20-record lists executed 143 SQL statements for Pages and 186 for
Posts. Most individual queries were inexpensive; executing them repeatedly was
the bottleneck. The implementation:

- Shares workflow role checks within a single serializer response, keyed by user
  and Site. Separation of duty remains evaluated for each content record.
- Shares the homepage eligibility permission within that response; each Page's
  publication, visibility and working-copy eligibility remains independent.
- Loads Post categories/tags in two bounded prefetches and the working-copy
  publication identity in a join. A correlated scalar subquery selects the latest
  published timestamp using the existing content/version index.
- Prefetches ordered Menu item snapshot fields for just the paginated menus,
  preserving exact published-versus-draft comparison and UUID normalization.
- Filters live role assignments by the requested registered permission in SQL,
  removing unused permission prefetches and per-assignment existence calls.
  The same successful assignment and audit path remain authoritative.
- Reuses Site owner and organization ancestor lookups only within one permission
  evaluation. Organization grants do not become CMS Site memberships.
- Projects only ID, name, code and status for Site discovery.

The serializer snapshots are local response data, not authorization caches.
Services and later requests re-read live membership, role, user, permission,
expiration and revocation state. No permissions or draft bodies are cached in
Redis by this change. The existing dashboard summary cache retains its scoped
keys, live gates, post-commit generation invalidation and documented TTL fallback;
see [PERF-006](P0-PERF-006.md).

## Query-plan and index decision

Review plans before proposing DDL. Existing SiteContent Site ownership/status/
recent indexes, assignment user/liveness and uniqueness indexes, taxonomy join
indexes, Menu sibling ordering and snapshot content/version indexes already
support the captured access patterns. At this dataset size PostgreSQL also
correctly chooses small sequential scans and sorts. Do not force index scans.

No new index or migration is justified by these plans. Additional indexes would
increase write/storage cost without addressing the measured repeated reads.
Consequently there is no index build, migration lock or rollback impact. If
larger deployments show sort spills, expensive deep offsets or substring search
scans, capture their production-like plans before considering a compound index,
keyset pagination or trigram search. Do not add redundant FK/status indexes.

## Payload and pagination policy

Bootstrap returns one selected Site; discovery is separately bounded at 50 and
uses a narrow projection. CMS Pages/Posts, Menus and Media remain server-paginated
with a default of 20 and maximum of 100. Existing strict endpoints reject
invalid parameters; DRF-based legacy pagination clamps excessive sizes and uses
its existing safe default/not-found behavior. Deterministic existing ordering,
UUID tie-breakers, distinct taxonomy joins and count semantics are retained.

Existing CMS Page/Post list bodies remain in the response for compatibility with
existing editor clients. This story does not silently remove contract fields or
defer a field that serialization then reloads per row. A future versioned compact
list representation can further reduce transferred bytes; current payload byte
measurements are retained in the load evidence. Media responses still omit
private object keys/credentials, and dashboard aggregates omit record bodies.

## Reproduction

Use an isolated development dataset and the opt-in `docker-compose.perf.yml`
backend (two synchronous Gunicorn workers, DEBUG false, instrumentation enabled).
The calling management shell must be DEBUG true and use only managed PERF001
fixtures. `scripts/perf/seed.py` creates 21 Sites when passed `PERF_SITES=21` via
private stdin configuration. Each Site has 40 Pages, 100 Posts, 80 assets, four
menus/48 items, five categories and ten tags. Never save the private session or
pipe credentials to an evidence file.

Copy `api-profile.py` and `api-load.py` into the backend's `/tmp`, then invoke
them through `manage.py shell -c "exec(open('/tmp/<script>').read())"`.
The profile needs no stdin. The load harness requires the same private config
used for seeding; it obtains a Keycloak bearer token in memory and performs real
HTTP reads against `http://perf-backend:8000`.

`api-load.py` warms each endpoint once, then executes 60 reads per endpoint with
four concurrent clients across 21 Sites (420 measurements). It asserts successful
status, pagination bounds, response Site ownership and enabled SQL timing
instrumentation. Output contains elapsed time, bytes, request IDs, SQL count/time
and cache hit state, never bodies or tokens. Run identical before/after scripts
without overlapping builds, seeds, tests or fault injection. Record the service
mode, resources and dataset alongside results. Permissions are profiled in-process
and checked through authenticated bootstrap/CMS HTTP requests.

Afterward use the existing `scripts/perf/cleanup.py` to disable the generated
identity, revoke its memberships, remove its private session and restore any
benchmark-specific login callback. Stop the isolated perf backend. Retain the
managed dataset for repeatability. Rebuild/restart backend services and workers
for deployment; no frontend rebuild or schema migration is introduced here.

## Acceptance evidence

See [dated SQL, load and regression evidence](../qa/P0-PERF-007/2026-11-16/README.md).
Budgets: workspace/dashboard API p95 ≤500 ms and paginated list API p95 ≤400 ms
under agreed conditions. Concurrency, network, role and sample count are part of
the result; local measurements are not production capacity certification.
