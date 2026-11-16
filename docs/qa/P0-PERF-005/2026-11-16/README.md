# P0-PERF-005 verification — 16 November 2026

The shared Site shell/query client remain mounted. Pages, Posts, Menus and Media now restore their scoped list controls, and inactive content rail links use bounded intent prefetch. **The final production run completed 171 samples with zero failures; all measured proposed budgets passed. Product/QA approval remains pending.**

## Production results

| Cached section return | p50 | p95 | Proposed target |
| --- | ---: | ---: | ---: |
| Pages | 221 ms | **289 ms** | 300 ms |
| Posts | 197 ms | **272 ms** | 300 ms |
| Menus | 198 ms | **256 ms** | 300 ms |
| Media | 236 ms | **289 ms** | 300 ms |

The original baseline scenarios remain in the same run: cached dashboard return **165 ms p95**, cached section transition **218 ms**, warm Site switch **302 ms**, cold switch **956 ms**, dashboard usable **956 ms**, workspace API **29 ms**, paginated list API **284 ms**. First uncached section navigation is **804 ms p95** and has no assigned budget. [Comparison with PERF-004](comparison.md) reports increases as well as decreases; the change does not claim every timing improved or that frontend work optimized the unchanged Django API.

[Raw samples and browser waterfalls](production/results.json), [allowlisted traces](production/traces.jsonl), [trace summary](trace-summary.json) and [cached-navigation inventory](cached-navigation-inventory.json) retain the measurement evidence. All **70** warm switch/cached navigation samples have **zero POST reads, zero workspace fetches and zero duplicate browser endpoints**. All 80 direct API probes correlate; 328 Django and 268 Next upstream spans were collected.

The private image delivery proxy retains `private, no-store`. Browser waterfalls count its requests separately because it does not forward navigation IDs to Django; a missing Django span alone does not establish zero image I/O. In this final run the cached-navigation windows contained no image requests. Navigation usable time measures usable lists/cards, not completion of every offscreen/lazy image decode. No blob cache or relaxed access policy was introduced.

## Browser and automated evidence

[Four-section browser regression](browser-sections.json) uses real Keycloak, Django/PostgreSQL, MinIO and the production Next build. Each section restores its search and rendered list order without a list RPC, bootstrap fetch or loading flash. Pages/Posts restore sorting and page two; Media restores page two and list layout. Menus restores its filtered directory. The shared shell DOM stays mounted. Switching to Site B opens its own default Media filters, with no search-form discard prompt.

[Mutation/cache/logout regression](browser-mutation-cache.json) confirms a managed draft save invalidates the affected cached list, restores its original title through another revision without changing publication, retains Site isolation and clears protected state on logout. Prototype results are not release evidence.

[Full frontend JUnit](full.xml): **617 passed, zero failures/errors, exit code 0** ([console](full.txt), [validation summary](validation-summary.json)). This includes 13 new tests for control restoration and sequential edits, Site/session/permission isolation, local picker state, mutation preservation, dwell/cancellation, canonical counts deduplication during navigation, throttling, disabled/foreign/unauthorized contexts, constrained networks, expired leases, unmounted intents and lost-page recovery without masking 403/ordinary 404/503 errors. Existing empty/error, mutation freshness, permission/module, draft and race regressions pass. [Metrics harness tests](metrics-tests.txt): three passed.

[TypeScript](typecheck.txt) and the [production build](production/build-events.txt) passed. [Built-source hashes](build-source.json) match all nine changed runtime files. No Django schema/API/migration changes were made.

## Failed-capture disposition

An earlier run stopped at 161 samples after one failed browser network check during a Media return. It is retained as [diagnostic evidence](diagnostic-network-failure/results.json), **not accepted release evidence**. That original harness did not retain the failing request row, so its cause cannot be established retrospectively; an allowlisted upstream-error scan found no correlated HTTP error. The harness now retains safe CDP error details and failed request rows, while continuing to fail on noncancelled errors or HTTP failures. The same application build then completed all 171 samples with the strict checks and zero failures. No application fix or root cause is claimed for that transient/unclassified event. QA should include a longer soak before final release acceptance.

## Conditions and reproduction

See the [implementation/policy guide](../../../performance/P0-PERF-005.md) and [PERF-001 methodology](../../../performance/P0-PERF-001.md). The same 21 representative Sites each contain 40 Pages, 100 Posts, 80 private images, five categories, ten tags and four menus with twelve items ([seed](seed.txt)). The generated account has only 21 Site Administrator grants; no organization/platform grant. Browser mutation rehearsal adds revisions while restoring the title before measurement.

The existing Windows 11 / i7-1355U / 16 GB host and Docker Desktop WSL2 profile ([allocation](docker-environment.json)) use production Next 15.5.28 / Node 22.23.3, two Gunicorn sync workers, headless Edge 157.0.4341.46, 1440×1000, unthrottled loopback and no CPU throttling. Tests, builds, seed work and functional mutation/logout checks completed before timing. Authentication is real and excluded. Cold/warm definitions, retained server/database caches and exact source hashes are in the raw metadata.

```powershell
./scripts/perf/run.ps1 -Mode production -Samples 10 -Sites 21 -SectionMatrix -Output docs/qa/P0-PERF-005/local
```

The optional matrix adds 40 section samples to the existing 131-sample harness. Each section has ten cached-return samples. Nearest-rank p95 of ten is the maximum, so these local smoke results are not statistical or production-Internet acceptance. Normal Next prefetch remains on other links; content rail prefetch is explicit hover/focus intent. Pre-initiation traffic is excluded from each navigation window and described in the metadata.

`scripts/perf/section-check.cjs` and `cache-check.cjs` accept the private session on stdin; never save/tee that payload. State is memory-only, Site/authorization/session partitioned and garbage-collected after five inactive minutes. Drafts, uploads and picker controls are not restored. Backend authorization and the original workspace lease remain authoritative.

[Source manifest](source-manifest.json), [secret scan](secret-scan.json) and [cleanup](cleanup.json) record provenance and retirement. The generated account is disabled, its 21 grants revoked, and private session material removed; representative data remains for reruns. Isolated benchmark services are stopped and ordinary services retain their prior state. Rebuild the admin service for deployment; **no migration is required**. External review, Issue/PR attachment, longer soak and product/QA methodology/budget approval remain pending.

| Criterion | Evidence |
| --- | --- |
| AC01 | Stable shell DOM; zero same-Site bootstrap reads in browser regression and cached inventory |
| AC02 | Existing shared readers/common lookups; restored scoped keys; zero unchanged list RPCs |
| AC03 | Four-section filter/order/pagination browser assertions and scoped state tests |
| AC04 | 180 ms intent, 1 s throttle, fresh permission lease, counts-only data; positive/negative tests |
| AC05 | Zero loading flashes; existing background-refresh/error regressions |
| AC06 | Canonical counts promise sharing; per-navigation waterfalls, duplicates and traces |
| AC07 | Full regression, live mutation/logout, lost-page recovery and denied-context tests |
| AC08 | 171 final samples; four section p95s below proposed 300 ms; approval/soak pending |
