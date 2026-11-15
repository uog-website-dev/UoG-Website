# P0-PERF-001 measurement evidence — 15 November 2026

Implementation and local baseline collection are complete. **Methodology and every budget remain PROPOSED; product/QA approval is pending.** These measurements identify optimization work; they do not certify performance acceptance.

## Results

Both production and development completed 131 samples with zero recorded failures. All 80 API samples per mode have correlated Django spans. Production contains 903 Django and 843 Next upstream spans; development contains 941 and 881 respectively. See the [comparison](comparison.md), [production raw samples](production/results.json), [development raw samples](development/results.json), and sanitized [production traces](production/traces.jsonl).

| Production scenario | p50 | p95 | Proposed p95 budget |
| --- | ---: | ---: | ---: |
| Cold Site switch | 1,696 ms | 2,455 ms | 2,000 ms |
| Warm Site switch | 1,127 ms | 2,342 ms | 1,000 ms |
| Cached section return | 1,102 ms | 2,118 ms | 300 ms |
| Cached section transition | 685 ms | 1,142 ms | 500 ms |
| Dashboard usable | 1,412 ms | 2,342 ms | 1,500 ms |
| Workspace API | 548 ms | 709 ms | 500 ms |
| Paginated list API | 297 ms | 440 ms | 400 ms |

All seven proposed p95 targets are exceeded. Median cold Site switches issue 21 browser requests, 25 Django requests and 891 SQL statements. Warm switches still issue 21 Django requests and 605 SQL statements; cached dashboard returns issue 17 Django requests and 328 statements. Reducing repeated workspace/permission/data fan-out is a measured optimization candidate. Aggregate SQL time spans multiple requests and is not a wall-clock critical path. Raw samples include duplicate endpoint identities, transferred bytes, request offsets and timing, cache flags and SQL totals for further analysis.

## Conditions and reproducibility

Follow the [methodology and runner instructions](../../../performance/P0-PERF-001.md). The pinned Playwright dependency installed successfully with `npm ci`. Each mode has ten cold/warm Site-switch pairs, ten first section visits and cached returns/transitions, 60 list API samples, 20 workspace API samples, and one first-Site diagnostic. Dashboard usable aggregates 31 dashboard navigations. Nearest-rank p95 with ten samples is the slowest observation; larger independent runs are required for acceptance.

The [verified dataset](dataset-environment.json) has ten Sites, each with 40 Pages, 100 Posts, 80 real private JPEG objects, five categories, ten tags and four menus containing 48 items. Twenty percent of Pages/Posts are published. The real Keycloak principal had ten Site Administrator memberships and no organization/platform grants. Each navigation pair signs in independently; authentication setup is excluded. Long-session token refresh is outside this baseline.

Hardware: Intel i7-1355U, 10 cores/12 logical processors, approximately 16 GB physical RAM, Windows 11 Pro, Balanced power plan. Docker Desktop/WSL2 exposes 12 CPUs and 8,167,542,784 bytes of memory. Browser: installed Edge, headless, 1440×1000, CPU factor 1, unthrottled loopback. Exact browser version and source hashes are in each results file. [Host CPU](host-cpu.json), [memory](host-memory.json), [OS](host-os.json), [power profile](power-profile.txt), [Docker](docker-hardware.json), [frontend runtime](frontend-runtime.json) and dataset runtime versions record the environment.

Production uses Next 15.5.28 / Node 22.23.3 and two Gunicorn sync workers. [Build milestones](production/build-events.txt) were captured separately from measured requests. Development starts with a fresh Next compilation directory; its [compilation events](development/compilation-events.txt) and first-Site diagnostic (13,117 ms versus production 2,010 ms, one sample each) are diagnostic, not population p95 estimates.

The host and database are shared development resources. The ordinary admin container was found stopped with exit code 0 and no OOM, with its finish timestamp late in the development run; production was measured with it stopped. It was left in that state. This workload difference, laptop power management, instrumentation and semantic readiness polling prevent interpreting the mode difference as compilation alone. SQL and server caches were retained; “cold” means a fresh browser context, not a cold database. No other test/build process ran during the final production measurement.

## Validation and disposition

- [Frontend JUnit](frontend-full-tests.xml): 567 passed, zero failures; TypeScript and production build passed. React test warnings remain non-blocking.
- [Backend JUnit](backend-tests.xml): 17 passed. [Django checks](backend-checks.txt): system check, migration drift check and OpenAPI validation passed; generated schema matched the committed baseline (121 paths). No schema changes or migration are introduced.
- [Harness tests](harness-tests.txt): three passed, covering percentiles/proposed budgets, URL redaction and network accounting.
- Earlier harness attempts using a long-lived/cloned session did not finish and are not baseline evidence. Their [first](diagnostics/stale-session-attempt.json) and [second](diagnostics/rotated-snapshot-attempt.json) dispositions are retained. Final runs use a fresh real login per pair without bypassing expiry or authorization.
- Two unit tests initially inherited the isolated 8088 origin rather than their localhost fixture environment. The [disposition](diagnostics/unit-test-environment.json) records the cause; the full suite passed under its canonical unit-test environment.
- [Secret scan](secret-scan.json) found zero matches against generated credentials, configured secrets and JWT patterns in the evidence. Raw HTTP headers, OAuth logs and private session files are not included.
- [Cleanup](cleanup.json): generated identity disabled, ten memberships revoked, private session deleted, representative dataset retained. Only the three isolated measurement services were stopped.

## Acceptance-criteria coverage and outstanding approval

| Criterion | Evidence |
| --- | --- |
| AC01 | Raw mode-specific samples and comparison, ten-Site verified dataset |
| AC02 | Browser marks and UUIDs in samples; linked Next/Django trace events |
| AC03 | Per-sample waterfalls, duplicates, bytes, SQL count/time and server request totals |
| AC04 | Separate mode-verified development/production runs and build/compilation events |
| AC05 | Environment files, methodology, sampling definitions and proposed budget register |
| AC06 | Reproducible seed/runner/harness, retained baseline and regression evidence |

Product/QA must approve the methodology, representative workload and budgets; approver/date remain empty in the [budget register](../../../performance/budgets.json). External code review, PR creation and Azure DevOps Issue attachments are not completed by this local run. Proposed performance overruns remain open findings for optimization, not waived targets.
