# P0-PERF-008 — secure read transport evidence

Implemented and verified with a production build and real Keycloak/Django browser
requests. Budgets and measurement methodology remain **PROPOSED** pending product/QA
approval. This is not a signed release acceptance or production capacity result.

## Change and inventory

[39 read exports inventoried](read-inventory.json). Workspace bootstrap/discovery
already used GET handlers. Common Page/Post lists, Page counts, dashboard summary/
activity, Media library/picker lists, taxonomy and Menu directory now use a fixed,
authenticated same-origin JSON GET BFF. Post taxonomy and Menu/inheritance reads
are parallel. Existing query keys/deduplication/invalidation are retained.
Editor/detail/preview/history/template compatibility actions remain documented;
mutations keep their existing Server Action, CSRF, ETag and Django permission paths.

Tokens remain in the server session/authentication path. There is no browser bearer
shortcut, arbitrary URL proxy, shared authorization cache or Django schema change.
Cancellation crosses client → Next → upstream, with a stale-result guard and bounded
timeouts. The handler validates Site ownership before forwarding successful JSON.
Negotiated gzip preserves efficient transfer, including gzip;q=0 and Vary handling.

## Before/after production navigation

Both completed runs contain 151 measurements, zero failures, 172 correlated Django
requests and 92 Next upstream spans. The same 21-Site managed dataset and Site-only
Administrator profile are used. [Before](before/production/results.json),
[after](after/production/results.json), [full comparison](comparison.md).

| Scenario | Before p50 / p95 | After p50 / p95 |
| --- | ---: | ---: |
| Cold Site switch | 324 / 340 ms | 393 / 447 ms |
| Warm Site switch | 102 / 141 ms | 108 / 139 ms |
| First Pages section navigation | 277 / 483 ms | 215 / 457 ms |
| Cached section return | 81 / 110 ms | 98 / 106 ms |
| Cached section transition | 81 / 91 ms | 96 / 98 ms |

For first Pages navigation, p50 read-action POSTs decrease **3 → 0**, with two JSON
read GETs; data read RPCs decrease **3 → 2**. Total HTTP requests increase **10 → 11**
inside the measured route/assets boundary. P50 transferred bytes decrease
**26,609 → 25,184**. Cold dashboard switching replaces two action reads with two
GETs; its total request count stays 16. The required browser → Next → Django trust
boundary remains, rather than removing Next security to save a hop.

Cold switching regresses by 107 ms at p95 in this sample, while first-section
median improves 22%. All budgeted scenarios remain within proposed targets. Do not
claim a universal speedup or fewer total requests. Follow-up PERF-008-F1: repeat
with at least 30 samples per scenario and investigate cold code/route loading and
host variability before accepting tighter cold-switch budgets. The budgeted cold
target is 2 seconds; this measured 447 ms remains well below it.

These are sequential local smoke runs at 1440×1000 in Edge 157.0.4341.60,
unthrottled loopback, production Next.js, two synchronous Gunicorn workers, real
PostgreSQL/Redis/Keycloak. Each of 21 Sites has 40 Pages, 100 Posts, 80 assets,
four menus/48 items, five categories and ten tags. Host: Windows 11, i7-1355U,
16 GB RAM; [Docker resources](docker-environment.json). No build, seed, full
regression suite or fault injection overlapped final navigation timing; a small
87-ms Node harness check ran during that smoke run. Retained caches and uncontrolled
host activity limit causal attribution; QA methodology approval is still required.

## Explicit overhead and browser security

[Real-browser read checks](browser-reads.json) passed **90 requests** across all
nine registered resources, plus sign-in/workspace and denial checks. Samples
record BFF/upstream/JSON-encoding Server-Timing spans, browser JSON parsing,
decoded body bytes and gzip negotiation. These decoded byte counts differ from
the benchmark's wire-transfer bytes.

| Resource | GET p95 | JSON encode p95 | BFF less upstream p95 |
| --- | ---: | ---: | ---: |
| Pages | 81 ms | 0.54 ms | 4.76 ms |
| Posts | 64 ms | 0.46 ms | 3.50 ms |
| Media | 47 ms | 0.27 ms | 3.55 ms |
| Dashboard summary | 32 ms | 0.08 ms | 3.14 ms |

Browser JSON parse p95 is at most 0.1 ms in this run. BFF less upstream includes
session work, validation and encoding; it excludes streaming gzip completion.
Network/queue time cannot be identified as pure serialization CPU. The before
Flight and after JSON transfer/timing comparison measures protocol overhead end
to end, not an isolated serializer benchmark.

Browser checks verify cookie-authenticated GETs without browser Authorization,
no token fields in read/session JSON, HttpOnly session cookies, private cache
headers, correlation IDs, gzip, anonymous 401, foreign-Site 403, hostile-Origin
403 and write-method 405. Dashboard summary/activity remain independent. No raw
credentials, response bodies, cookies or provider errors are recorded.

## Regression and source verification

- [642 admin tests passed](full.xml), [full output](full-tests.txt), including
  existing UI/workflow/authorization-cache and unsaved-state behavior.
- [Final 21 transport tests passed](final-focused-gzip.xml),
  [output](final-focused-gzip.txt), after the final trace-ID/compression refinements.
  The 642-test run preceded those final refinements; these focused cases and the
  final production build verify them.
- [166 shared API-client tests passed](api-client-tests.txt), including a timeout
  with an independent caller cancellation signal.
- [TypeScript passed](typecheck.txt), [production build milestones](build-events.txt),
  [runtime source verification](build-source.json), [baseline source proof](before-source.json),
  [validation summary](validation-summary.json), [source manifest](source-manifest.json).

The first full run used the perf container's localhost:8088 AUTH_URL and failed
two existing OAuth assertions expecting localhost; [initial report](initial-full.xml).
Running the suite with its normal test hostname passed all 642 without relaxing
auth checks. Earlier after-before-trace-fix and after-before-gzip directories are
superseded diagnostics, not release evidence: correlation collisions and missing
JSON compression were found and fixed before the final after/ run.

## Deployment and remaining approval

See [request pattern and reproduction guidance](../../../performance/P0-PERF-008.md).
Rebuild/restart **admin-web**. No Django migration, CORS expansion or browser token
configuration is required. The shared client change is incorporated when its
other consumers are next rebuilt; their no-signal behavior remains unchanged.

[Cleanup](cleanup.json) disables the generated login, revokes its 21 Site
memberships and removes its private session; [failed seed identities](orphan-cleanup.json)
were also disabled within the guarded task time window. The isolated performance
services are stopped; the representative dataset is retained.
[Credential scan](secret-scan.json). Product/QA sign-off, external code review and
linking the PR/evidence to the Issue remain pending.
