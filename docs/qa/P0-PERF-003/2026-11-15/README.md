# P0-PERF-003 verification — 15 November 2026

The admin now uses one memory-only TanStack Query cache for workspace, section and dashboard reads. **Production collection completed 131 samples with zero failures. Budgets/methodology remain PROPOSED pending product/QA acceptance.**

## Navigation results

| Production measurement | PERF-002 p95 | PERF-003 p95 | Proposed target |
| --- | ---: | ---: | ---: |
| Cached section return | 1,138 ms | **182 ms** | 300 ms |
| Cached section transition | 777 ms | **195 ms** | 500 ms |
| First section navigation | 815 ms | 702 ms | Not assigned |
| Dashboard usable | 1,198 ms | 1,043 ms | 1,500 ms |
| Cold Site switch | 1,520 ms | 1,043 ms | 2,000 ms |
| Warm Site switch | 1,014 ms | 1,114 ms | 1,000 ms |
| Workspace API | 50 ms | 29 ms | 500 ms |
| Paginated list API | — | 297 ms | 400 ms |

Cached return p95 improved **84.0%** and cached transition **74.9%**. Both proposed section targets are met in this local smoke run. All **20** cached return/transition samples made **zero Django requests, zero SQL statements and zero POST reads**. The two remaining median browser requests are Next route traffic, not repeated list reads. [Inventory](cached-navigation-inventory.json), [comparison](comparison.md), [raw samples](production/results.json) and [sanitized traces](production/traces.jsonl) retain the evidence.

Warm switching remains above its separate proposed target. Changing Sites deliberately disposes protected data, including data for an earlier Site that this user may also administer. It is not accelerated by retaining old Site content. The cold/warm request totals also include newly correlated Media adapter traffic that was previously missing a navigation ID; the additional correlated request/SQL totals are not evidence of a newly introduced data fetch. Browser counts and the dedicated no-read assertions establish the cache effect directly.

There are 528 correlated Django spans and 468 Next upstream spans. All 80 direct API samples correlate. The 20 cached navigations intentionally have no Django span; this is verified by browser waterfalls, not assumed from missing logs. Improvements in direct API timings are observations on a shared host, not a claim that this frontend change optimized Django execution.

## Real browser workflow

[Production browser check](browser-cache-check.json), using real Django, Keycloak, private MinIO and the production Next build:

- Pages, Posts, Menus and Media each return with **zero list-read RPCs and zero loading flashes**.
- Saving an existing managed draft changes the previously cached Pages list. The title is then restored through a new revision; no published snapshot changes.
- Switching Sites removes the old context and produces correctly scoped links. Returning to the earlier Site performs new authorized reads.
- Logout clears the session and disposes protected query state.

`scripts/perf/cache-check.cjs` repeats this check using the same private stdin session as the smoke harness. Its recovery path restores only its selected managed draft if a UI assertion fails. It does not write private input to evidence. Prototype fixture results are not used as release evidence.

## Automated validation

The final full frontend report is [current-full.xml](current-full.xml), with readable output in [current-full.txt](current-full.txt). Earlier full collection passed 583 tests; additional cache, dashboard and picker regressions were added afterward. Focused reports cover the final code:

- [Cache/race and action contracts](race-final-tests.xml): **23 passed**, including 15 cache cases; a late forbidden read from an abandoned Site cannot reset the new Site's view.
- [Cache/workspace/dashboard](final-cache-tests.xml): **27 passed**, including bounded revalidation of unchanged 403 responses.
- [Canonical shared reads](canonical-tests.xml): **58 passed**; dashboard Page counts and the initial unrestricted Media list share their raw section queries.
- [Dashboard refresh recovery](dashboard-tests.xml): **8 passed**; confirmed totals remain visible during transient refresh failure, with retry.
- [Media library](media-tests.xml): **26 passed**, including paused selection while cached eligibility refreshes.
- [Post list/editor](posts-final-tests.xml): **19 passed** after moving the editor's taxonomy lookup to the same shared query.
- [Backend workspace/RBAC/OpenAPI](backend.xml): **37 passed**. No Django source/schema changes or migrations were introduced.
- TypeScript, production build and [Django checks](backend-checks.txt) passed. [Build milestones](production/build-events.txt) exclude raw auth logs.

The migration initially exposed test assumptions that a return to page one must issue another request, and standalone component fixtures missing the provider. Those fixtures now use real isolated QueryClients, wait for usable data rather than skeleton tables, and assert cache reuse. No cache behavior is mocked away. A pre-final normal-path measurement is retained under `diagnostics/prior-final-error-guard`; the release comparison uses the final production run after the late-denial guard was fixed and rebuilt.

## Conditions, reproduction and cleanup

See the [implementation/key/invalidation guide](../../../performance/P0-PERF-003.md) and [PERF-001 methodology](../../../performance/P0-PERF-001.md). The same ten Sites, each with 40 Pages, 100 Posts, 80 real private media objects and the existing menu/taxonomy fixtures, were reused. Browser rehearsal adds draft revisions while restoring the title and preserving publication. The generated principal has ten Site Administrator memberships and no platform/organization grants.

The Windows 11 / i7-1355U / 16 GB host and Docker Desktop WSL2 profile match the earlier baseline. [Docker environment](docker-environment.json) records the current allocation. Production uses two Gunicorn sync workers, Next 15.5.28, Node 22.23.3 and headless Edge 157.0.4341.46 at 1440×1000 on unthrottled loopback. The ordinary admin container remains stopped as before. Tests and builds did not run during either timed collection. Unit tests restarted only after final measurements completed.

Each mode has ten navigation samples per scenario, 60 list API samples, 20 workspace API samples and a single first-Site diagnostic; dashboard usable aggregates 31 navigations. Nearest-rank p95 with ten samples is the slowest sample. Shared hardware, retained server/database caches and small samples require repeated larger runs before acceptance. Both compared runs use the searchable switcher and include discovery in switch timing.

```powershell
./scripts/perf/run.ps1 -Mode production -Samples 10 -Output docs/qa/P0-PERF-003/local
node scripts/perf/compare-workspace.cjs docs/qa/P0-PERF-002/2026-11-15/production/results.json docs/qa/P0-PERF-003/local/production/results.json
```

The cache is not persisted to localStorage, sessionStorage, IndexedDB or disk. HTTP bootstrap/search reads abort; Server Action reads are logically cancelled and discard late results even if server work finishes. Session/permission revalidation remains bounded as documented; no server-push revocation guarantee is claimed. Readonly private previews and editable revision/ETag fetches remain intentionally fresh rather than list-cache authorities.

Final [source hashes](source-manifest.json), [secret scan](secret-scan.json) and [generated-account cleanup](cleanup.json) are recorded beside this report. Deploy the rebuilt admin and locked dependencies together. External review, Issue/PR attachment and product/QA methodology approval remain pending; the warm-switch overrun is retained as an open performance finding.

## Acceptance mapping

| Criterion | Evidence |
| --- | --- |
| AC01 | Pinned TanStack Query, app provider, key/invalidation guide |
| AC02 | Session nonce, Site/authorization/resource/parameter keys; partition tests |
| AC03 | Migrated section/workspace/dashboard/editor taxonomy readers; real-browser reuse |
| AC04 | Concurrent dedup, finite stale/GC defaults, background refresh, cancellation/GC tests |
| AC05 | Server-confirmed scoped receipts, targeted invalidation, mutation/read race and failed-write tests |
| AC06 | Site/session disposal, logout, known revocation purge and denied-resource tests; no persistence |
| AC07 | Slow filter/Site success and denial races; Site-switch browser assertions |
| AC08 | No loading flashes, visible refresh state, cached-data error recovery and picker eligibility checks |

Final full frontend run: **592 passed, 0 failed** ([JUnit](current-full.xml), [console](current-full.txt)); final [typecheck](typecheck.txt) passed.
