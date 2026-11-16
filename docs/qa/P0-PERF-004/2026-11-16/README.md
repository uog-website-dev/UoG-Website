# P0-PERF-004 verification — 16 November 2026

The Site switch now preserves the shared shell and authorized section, resets editable Site state, and reuses bounded, scoped read/context caches. **Production completed 131 samples with zero failures. All measured proposed budgets passed. Product/QA approval of budgets and methodology remains pending.**

## Production measurements

| Scenario | PERF-004 p50 | PERF-004 p95 | Proposed budget |
| --- | ---: | ---: | ---: |
| Warm Site switch | 212 ms | 236 ms | 1,000 ms |
| Cold Site switch | 892 ms | 1,112 ms | 2,000 ms |
| Dashboard usable | 213 ms | 1,112 ms | 1,500 ms |
| Cached section return | 126 ms | 171 ms | 300 ms |
| Cached section transition | 195 ms | 227 ms | 500 ms |
| Workspace API | 28 ms | 40 ms | 500 ms |
| Paginated list API | 240 ms | 378 ms | 400 ms |

Warm switch p95 fell from **1,114 ms to 236 ms (78.8%)** versus PERF-003. Cold switch p95 rose from 1,043 ms to 1,112 ms while remaining within its proposed target. [Comparison](comparison.md) includes all timing and request/SQL changes; this is not a claim that every metric improved.

All **10 warm Site switches** and **20 cached section navigations** made **zero Django requests, zero SQL statements and zero POST reads**. [Inventory](cached-navigation-inventory.json) verifies this against both browser waterfalls and correlated server counts. [Raw samples](production/results.json) retain request counts, bytes, duplicates, blocking candidates and timings. [Sanitized traces](production/traces.jsonl) contain 328 Django and 268 Next upstream spans. All 80 direct API probes correlate. Thirty cached navigations have no Django span, as expected and verified by their waterfalls.

## Functional and security evidence

[Real production browser check](browser-switch-check.json), with real Keycloak, Django/PostgreSQL and the production Next build:

- Keyboard pagination over **21 authorized Sites**, debounced search and keyboard Site selection pass.
- Switching from Pages stays in the target's Pages section; a fresh return performs zero list-read RPCs. The shared shell DOM remains the same, and the previous Site body disappears.
- Cancelling the native unsaved-changes confirmation preserves Page text. Accepting discards the local draft, removes the foreign Page ID from the destination and shows the target's scoped list.
- Rapid A→B→A with an intercepted, delayed B bootstrap returning 403 leaves A readable. This is an explicitly injected transport failure; the other checks use real services.
- Revoking the generated principal's actual Django membership removes A's protected content after explicit revalidation. The switcher can still recover to permitted B. The harness restores only its generated fixture membership in `finally`; cleanup subsequently revokes all generated grants.

[Full frontend JUnit](full.xml): **604 passed, zero failures/errors, exit code 0** ([console](full.txt), [summary](validation-summary.json)). Coverage includes eight dedicated switch tests: route normalization/fallback, stable shell and empty forms, unsaved confirmation, delayed A-B-A denial/abort, expired-context permission revocation, failed direct links, Back recovery and the original lease deadline with deduplicated focus/timer refresh. Existing cache, workspace, module-gate, session/logout, Page/Post/Builder, Media and Menu regressions also pass. The Page editor has a separate dirty-state regression for controls outside a `<form>`. Three additional regressions cover late Page/Post saves and a late working-draft redirect after unmount. Writes still invalidate their original Site, while obsolete completions cannot navigate or update a new workspace.

[TypeScript](typecheck.txt) and the [production build](production/build-events.txt) pass. [Production source hashes](build-source.json) match the current eleven affected runtime sources. No Django model, API schema, workflow or migration was changed. Live revocation exercises the canonical membership path; existing API/BFF contracts remain covered by the frontend suite.

The browser rehearsal exposed the Page editor's non-form markup; its existing dirty comparison now registers with Site switching. It also exposed a test locator that could not see the background editor while the modal remained open; the test now closes the modal before checking preserved text. The component suite caught a lease timer restarting an in-flight bootstrap; refreshes now share transport. Final code review also found old Page/Post write completions could navigate after unmount; mounted Site operation guards and late-write tests resolve that race. These defects are resolved in this verified build. An earlier successful measurement before the write guards is retained under `production-before-late-write-guard`; the release comparison uses `production`.

## Methodology and limits

See the [implementation and policy guide](../../../performance/P0-PERF-004.md) and [PERF-001 methodology](../../../performance/P0-PERF-001.md). The development-only representative dataset was expanded from 10 to **21 Sites**, each with 40 Pages, 100 Posts, 80 private image objects, five categories, ten tags and four menus with twelve items ([seed output](seed.txt)). The generated principal has Site Administrator memberships only. The first ten switch pairs use the same existing Sites as the preceding baseline. Increased discovery size and membership count make the comparison directional rather than an identical-dataset experiment.

The Windows 11 / i7-1355U / 16 GB host, Docker Desktop WSL2 allocation ([environment](docker-environment.json)), production Next 15.5.28 / Node 22.23.3, two Gunicorn sync workers and headless Edge 157.0.4341.46 use the existing PERF-001 profile: 1440×1000, unthrottled loopback, no CPU throttling. Authentication is real and excluded from timings. Cold means fresh browser/HTTP/router cache, with server/database caches retained; warm means a previously visited target in the same session without forced invalidation. Lazy switcher discovery is included. Tests, seed work, builds and fault injection completed before timed collection.

Each switch/section scenario has ten samples, direct lists sixty, workspace twenty and dashboard usable thirty-one. Nearest-rank p95 of ten samples is the maximum. This local smoke run does not establish production Internet latency or statistical acceptance; repeat larger runs under agreed conditions. Permission/UI freshness is a bounded thirty-second lease, not server-push revocation. A fresh return may reuse validated context; an expired or invalidated context must revalidate before protected rendering. Known denial removes protected data. Every backend operation remains independently authorized.

Run `scripts/perf/run.ps1 -Sites 21` for the comparable measurement, then `collect-traces.cjs` and `compare-workspace.cjs` as documented. For the 21-Site regression, pipe the private `prepare-session.py` result directly to `scripts/perf/site-switch-check.cjs`; set `PERF_SWITCH_CHECK_OUTPUT` to the desired evidence path. Never tee the private session payload to evidence.

## Disposition

[Source manifest](source-manifest.json), [secret scan](secret-scan.json) and [generated-principal cleanup](cleanup.json) record final provenance and retirement. The temporary principal is disabled, generated Site grants are revoked, the private session file is removed and only the representative dataset remains. Only the isolated performance services were stopped; the ordinary admin service remains in its original stopped state.

Deploy the rebuilt admin service; **no database migration is required**. External code review, Issue/PR attachment and product/QA methodology/budget approval remain pending.

| Criterion | Evidence |
| --- | --- |
| AC01 | Session-only QueryScope key; editable-content Site key; unit and real shell-DOM assertions |
| AC02 | Immediate pending Site identity, scoped bootstrap, route-preserving browser workflow |
| AC03 | Registry-based section root mapping and disabled/forbidden Dashboard fallback tests |
| AC04 | Page/Post/Builder dirty guards, conservative form guard, reset boundary and browser Cancel/Accept |
| AC05 | HTTP abort, Server Action cancellation, delayed-denial A-B-A tests and live browser injection |
| AC06 | Original 30-second lease, expiry gate, scoped fingerprint purge, focus/timer dedup tests |
| AC07 | Real 21-Site keyboard pagination/search/selection; existing stale-search tests |
| AC08 | 131 production samples, proposed switch targets met, rapid-switch and actual revocation evidence |
