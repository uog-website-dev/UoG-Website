# P0-PERF-001: repeatable navigation baseline

**Status: methodology and every budget are PROPOSED. Product/QA acceptance is pending.** A recorded measurement does not approve a target or certify a release. [Budget register](budgets.json) has no approver/signature and the smoke harness never fails solely for a proposed-budget overrun.

## Controlled environment

The performance Compose overlay adds three isolated services: a private Gunicorn backend (two sync workers, DEBUG=False), a Next.js admin process and a loopback-only nginx gateway on port 8088. Existing development apps keep their ports and `.next` directories. The Next process builds/serves a temporary source copy for production; development starts a new temporary copy with an empty compilation cache. Both use the same production-mode Django service and shared data services. This separates development from production measurements but does not establish a controlled causal comparison on a shared laptop. Builds finish before measurements begin. Stop other builds/tests while collecting the baseline.

The seed is bounded to managed `PERF001-*` Sites under its own organization. Defaults are **10 Sites, each with 40 Pages, 100 Posts, 80 real private JPEG objects, 5 categories, 10 tags and 4 menus of 12 items**. Twenty percent of Pages/Posts traverse the real approval/publication workflow with separate actors; the remainder are drafts. Text bodies contain several kilobytes of university sample copy. JPEGs are generated 640 x 400 fixtures; this is a metadata/navigation workload, not an upload bandwidth or high-resolution rendering benchmark. No copied or fake storage identities are used. Seed reruns fill missing managed fixtures without duplicating the catalogue.

The browser principal has the canonical Site Administrator role on these 10 Sites and no platform role. A real Keycloak browser login establishes its encrypted httpOnly session. Auth setup and token acquisition are excluded from navigation/API durations. Each cold/warm navigation pair establishes an independent real Keycloak browser session before its source-Site warmup; this controls token age without changing expiry or permission rules. Long-session refresh/expiry behavior is a separate soak condition, not certified by this fresh-session baseline. Credentials enter the seed and browser over stdin; do not tee the private session preparation output, record a HAR/Playwright trace with headers, or commit `/tmp/perf001-session.json`. Runtime configuration/Keycloak secrets stay server-side.

## Definitions and sampling

- **Cold Site switch:** start in a loaded source Site, then use the real workspace selector to switch to an unvisited target in a fresh browser context. HTTP/browser/router caches are fresh for the context; server, Redis and PostgreSQL caches are retained. This is a client-cold switch, not a restarted database or cold machine.
- **Warm Site switch:** return to the source and select the already visited target in the same browser context.
- **Same-Site menu navigation:** follow the real Site sections rail to Pages, Posts or Menus for the first time in that context, with normal Next prefetch behavior retained.
- **Cached section return/transition:** return to the visited dashboard, then revisit the visited section. "Cached" denotes a warm Next navigation path; it does not assert that the current implementation caches component data. Repeated API calls remain visible in the evidence.
- **Dashboard usable:** the selected Site's frame, ready workspace navigation, quick actions and all visible summary sources have settled without a loading marker or error. It is not merely a visible heading. Captured for dashboard navigations.
- **First Site visit:** a separate diagnostic sample starts at the authenticated console before opening the first Site. In development it captures initial Site-route compilation. It has one sample per fresh service instance, so its p95 is not a population estimate.
- **API latency:** direct Site-owned paginated Pages/Posts/Assets responses include full body download. Workspace latency measures the actual authenticated Next `/admin/api/workspace/?site=...` request, including its Django fan-out. "Cold/warm" API labels denote first call versus immediate repeat for that Site/resource; server caches are not flushed.

Default smoke sampling uses ten cold/warm Site-switch pairs, ten section first visits, ten returns/transitions, and API samples across all ten Sites. Percentiles use nearest rank: sorted item `ceil(p*n)`. Ten samples are suitable for diagnosing a smoke run, but p95 is unstable at that size; use at least 30 per scenario and repeated independent runs for product/QA acceptance. Failed requests, inaccessible contexts or missing performance marks fail the smoke run rather than becoming fast latency samples. No retries are silently substituted into a measured sample. Browser-cancelled requests (for example replaced prefetches during development refresh) are counted separately from failed requests.

Per-navigation network accounting starts at initiation and captures a 250 ms completion grace after usable; elapsed usable time excludes the grace. Browser encoded response bytes and request payload bytes are recorded separately and summed; TCP/TLS overhead and request header bytes are not claimed. Bootstrap and prefetch that completed before initiation are outside that navigation's count. Each waterfall includes offsets, duration, wait/connect/DNS time where CDP provides it, cache flags and initiator type. Late request candidates are evidence of possible blocking waterfalls, not proof of causal dependency. Contexts are sequential and service workers are blocked.

Timing includes the harness's semantic readiness polling and enabled profiling overhead. The recorded run uses an unthrottled loopback network, desktop viewport and a shared Windows/Docker host with a Balanced power plan. It does not certify WAN, mobile CPU, exclusive-host or power-locked performance. Record background workload changes alongside each run.

## Correlation and SQL profiling

`PERF_INSTRUMENTATION_ENABLED` defaults off. When explicitly enabled, the admin mounts navigation timing hooks and server-side API clients use `serverApiFetch`. The browser emits `uog:navigation:<uuid>:start` / `:usable` marks and a matching measure. A UUID/start epoch is retained briefly in sessionStorage across development remounts. If a full reload erases the old Performance timeline, the resumed document measure is explicitly labeled `resumed-document`; the external Playwright monotonic duration still includes the entire compilation/reload delay. Requests carry `X-Navigation-ID` and client span/request IDs. The server API wrapper propagates that navigation ID and records the incoming request ID as `X-Parent-Request-ID`; Django retains a unique `X-Request-ID` per API request. Native browser requests may share the navigation operation ID as their parent fallback; ordinary fetches receive individual span IDs. Authorization/session handling is not rewritten by middleware.

Django's opt-in middleware uses database execution wrappers (not DEBUG query logging) to count and time SQL across configured aliases. It logs route templates, validated UUIDs, method, status, aggregate SQL count/time and total response time. It does not store SQL text, parameters, URL query strings, request/response bodies, user names, cookies or Authorization headers. A small allowlist of bounded pagination/status fields identifies repeated endpoint variants; free-text search is excluded. Streaming body work after response construction is explicitly excluded. It also returns aggregate Server-Timing and SQL-count/time headers in this controlled environment.

Next spans record backend request IDs, parent/navigation IDs, duration, status and the aggregate SQL headers. They do not log URLs, payloads, auth headers or exception text. Trace collection writes only these allowlisted structured events for sample navigation IDs; it never saves raw container logs (which can contain OAuth callback query values). Django request IDs are deduplicated before SQL sums, avoiding double-counting Next spans. Fully cached transitions can legitimately have no Django span; the browser waterfall must support that conclusion.

## Reproduction (Windows PowerShell, repository root)

Prerequisites: healthy normal Compose data services and backend; `.env` configured for real local Keycloak/MinIO; Edge plus Playwright-core. Install the pinned harness dependency with `npm ci --prefix scripts/perf --ignore-scripts`, or set `UOG_QA_PLAYWRIGHT_ROOT` to an already installed Playwright-core 1.65.0 module path. `PERF_BROWSER_PATH` can select a different installed Chromium executable. No external account credentials belong in benchmark artifacts.

```powershell
$env:UOG_QA_PLAYWRIGHT_ROOT="$env:TEMP/uog-layout-a11y-tools/node_modules/playwright-core"
./scripts/perf/run.ps1 -Mode production -Samples 10 -Output docs/qa/P0-PERF-001/local
./scripts/perf/run.ps1 -Mode development -Samples 10 -Output docs/qa/P0-PERF-001/local -SkipSeed
node --test scripts/perf/metrics.test.cjs
```

Each run recreates only the opt-in measurement services; it does not reset the shared database, Redis or ordinary dev apps. First creation builds the production app and may take several minutes. Use the canonical `/admin` entry URL. The runner waits for readiness before issuing a fresh private API token. Each sample is checkpointed atomically; `run_status=running` or `failed` artifacts cannot be promoted by the trace collector. For long interactive sessions, `scripts/perf/launch.cjs` can receive the prepared private stdin stream and launch a detached, hidden benchmark; poll `results.json` until `run_status=complete` before collecting traces. The launcher records only a PID and output directory, not credentials. `results.json` contains all raw samples, summary p50/p95, per-condition summaries, proposed budget comparisons, browser marks, network counts/duplicates/bytes/waterfalls and correlated SQL aggregates. `traces.jsonl` contains sanitized linked service events.

Retire generated access after collecting both modes: copy `scripts/perf/cleanup.py` into backend `/tmp`, then pipe the same private configuration used by the seed into `manage.py shell -c "exec(open('/tmp/cleanup.py').read())"`. The helper disables only its generated identity and revokes its memberships, removes only a callback/origin it added, deletes the private session and retains representative content for reruns. Stop only `perf-gateway perf-admin perf-backend` when finished. A later seed run creates a fresh rehearsal principal against the retained dataset.

## Proposed budgets and review

| Scenario | Proposed p95 |
| --- | ---: |
| Warm Site switch | 1,000 ms |
| Cold Site switch | 2,000 ms |
| Cached section return | 300 ms |
| Cached section transition | 500 ms |
| Workspace API | 500 ms |
| Paginated list API | 400 ms |
| Dashboard usable | 1,500 ms |

Product/QA must review the hardware and shared-service contention, representative counts/statuses, cold/warm definitions, normal prefetch, role, viewport/network profile, usable predicates, profiling overhead and sample size. Record acceptance/changes and an approver/date in the budget register only after explicit acceptance. Proposed overruns are findings, not automatically waived targets. [Recorded local evidence](../qa/P0-PERF-001/2026-11-15/README.md).
