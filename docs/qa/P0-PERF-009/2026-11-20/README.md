# P0-PERF-009 ? production rendering evidence

Measured 20 November 2026 on PERF-008 (`2714f25`) plus the changes in this working tree. Product/QA acceptance and external code review remain pending. All budgets remain proposed.

## Method and environment

Isolated Docker perf services, local Edge headless at 1440?1000, localhost network without throttling, authenticated Site Administrator and the PERF-001 dataset across 21 Sites. Production is precompiled Next.js; development compilation is measured separately. Main production runs contain 151 samples each, including ten samples per navigation scenario; development and profiling runs use two repetitions and are diagnostic only. Browser deep-link checks use one sample per route with HTTP script caching disabled and are not percentile evidence. See results metadata for dataset, browser and environment details. No production user data or credentials are recorded.

The before server was copied from PERF-008 before implementation. Benchmark driver source hashes reflect the checkout when the driver started, not necessarily that earlier server copy. Emitted bundle hashes identify the measured build; `production-source.json` records the final unprofiled build inputs.

## Results

| Measurement | Before | After |
| --- | ---: | ---: |
| Same-Site first section navigation p95 | 562 ms | 456 ms |
| Warm Site switch p95 | 138 ms | 136 ms |
| Cold Site switch p95 | 406 ms | 470 ms |
| Cached section return p95 | 108 ms | 122 ms |
| Cached section transition p95 | 95 ms | 111 ms |
| Dashboard usable p95 | 406 ms | 470 ms |
| Paginated API p95 | 52 ms | 45 ms |
| Workspace API p95 | 40 ms | 46 ms |
| Dashboard API p95 | 39 ms | 33 ms |
| Page editor initial JS, Brotli estimate | 308687 bytes | 291902 bytes |
| Post editor initial JS, Brotli estimate | 323510 bytes | 293289 bytes |
| Builder initial JS, Brotli estimate | 339499 bytes | 319558 bytes |
| Context consumer renders across four unrelated parent updates | 5 | 1 |

All eight final route bundle ceilings pass. Some small routes grew slightly; this is not a universal speedup. Cold switching and cached transitions regressed within proposed budgets. First Site visit was 960 ? 2901 ms (one observation, not a reliable percentile). Request/SQL counts for that observation remained 21 browser requests, four Django requests and 50 queries. Further first-load sampling is needed before claiming improvement there.

Development recorded 14 compilation events, including 8.9 s for `/` and 5.2 s for `/api/session`. Readiness requests may trigger compilation before the timed navigation. The final development first Site visit was 8101 ms versus production 2901 ms, each one observation. Development timings are not release baselines.

## Functional and rendering evidence

- `full.xml` / `full-tests.txt`: 652 admin tests passed, zero failures/errors.
- `typecheck.txt` and `production-build.txt`: TypeScript and production build pass.
- `harness-tests.txt`: four bundle/compilation collector tests pass.
- `before-renders.txt` / `after-renders.txt`: controlled provider subscription/render regression passes (5 ? 1).
- `before/render-browser.json`, `after/production/render-browser.json`, `after/development/render-browser.json`: five authenticated deep links pass, with no horizontal overflow; editor text survives opening/cancelling the lazy picker.
- Post picker loads six additional JS assets only when opened in the final build. Initial route manifests exclude this deferred code.
- Recorded layout shifts were unchanged at displayed precision; Pages diagnostic CLS is approximately 0.105, an existing limitation, not a clean Core Web Vitals certification.
- Static production code responses retain immutable caching; checked private API responses are not publicly cached. Tokens stay server-side.

## Unresolved diagnostic and acceptance limits

`react-profile/render-browser.json` records a failed optional diagnostic: Next's production profiling configuration was enabled, but no React Profiler callbacks were emitted. Do not treat this as component-level production timing evidence. CDP CPU/layout measurements and controlled React render-count tests are available; resolving the production callback instrumentation remains follow-up work before claiming full AC02/AC04 production profiling acceptance. Profiling benchmark metadata explicitly excludes that build from the release baseline.

No backend authorization logic or migrations changed. This run does not replace previous IAM/API tests, manual accessibility sign-off, external review, Product/QA methodology approval, or an Issue attachment. No PR was opened or deployed by this task.

## Reproduction and artifacts

See [implementation and commands](../../../performance/P0-PERF-009.md). Run the existing `scripts/perf/run.ps1` separately with `-Mode production` and `-Mode development`; use private configuration via stdin. Run `render-check.cjs` against the corresponding server. Use `perf:bundles` after a production build and `perf:test` for collectors. Never copy private session/configuration into evidence.

Raw samples and correlated spans are in `before/production`, `after/production`, and `after/development`. Bundle reports are `before-bundles.json` and `after-bundles.json`; compilation attribution is `after/development/compilations.json`. Profiling artifacts remain separately under `react-profile`.

Rebuild admin-web for deployment; no migration is needed. The temporary benchmark identity is disabled and its memberships revoked during cleanup; representative fixtures remain for repeatability.
