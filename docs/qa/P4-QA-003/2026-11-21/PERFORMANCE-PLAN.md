# QA performance gate ? required measurement, not an executed result





**500-user result: NOT RUN / BLOCKED.** The supplied environment label is ?QA?; no QA URL, approved workload mix/duration, representative dataset, methodology approval or infrastructure capacity evidence has been supplied. No 500-user load was directed at the shared active development stack.





Release target: measured p95 **load time under 1,500 ms** with **500 concurrent users** under the agreed representative workload. Define ?load? (browser usable/LCP, navigation, or API response) before execution; HTTP response latency cannot substitute for browser usable time. Capture raw timings, percentile method, active virtual users, actual in-flight requests, arrival rate, throughput, errors and dropped/unfinished work. Do not equate 500 requests total with 500 concurrent users.





Proposed methodology for QA/infra approval, **not yet agreed**:





- Production Next.js and production Django deployment; record image/commit digests, hardware limits, worker counts, PostgreSQL/Redis/MinIO/Keycloak topology, network/CPU profile and authentication roles.


- Representative Main and child Sites with realistic Pages, Posts, media, menus and permissions; prefer an isolated restored QA dataset over live institutional content.


- Approve a public/editor workload mix, ramp schedule, warm-up, steady duration, think time, cache definitions and safe write fixtures. Maintain 500 active virtual-user sessions during steady measurement; record achieved rather than configured concurrency.


- Measure per-critical-route p50/p95 and errors during steady load, plus actual browser usable-time samples under the same load. Separate cold/warm behavior and development compilation from production results.


- Include Site switching, dashboard and common CMS reads. Include authoring mutations only on designated disposable QA content with approved cleanup; protect Main/other-Site records and keep tokens server-side.


- Capture correlated Next/Django/SQL timing and operational saturation. Abort or stop according to the QA/infra-agreed safety and error limits; aborted tests remain failed/incomplete evidence.





Historical evidence: [PERF-010 report](../../P0-PERF-010/2026-11-20/README.md) and [API load](../../P0-PERF-010/2026-11-20/api-load.json) cover **four concurrent clients**, not 500. Its cached Pages/Posts/Menus p95 values exceed the older proposed **300 ms cached-return** budget. Those failures are separate from, and do not measure, the requested 1,500 ms / 500-user release target. Both methodology approval and outstanding dependency-gate reconciliation remain open.





Populate the release manifest only from a completed reviewed run. Keep missing p95/concurrency as missing, not zero-latency success. The release-gate tests reject missing/nonfinite durations, a 1,500 ms boundary value, insufficient concurrent users and incomplete/errorful tests.



Gate input requires at least 500 finite nonnegative `raw_samples` (milliseconds), `percentile_method: nearest_rank`, and a reviewed `measurement_definition`. The gate recomputes p95 from the raw values; a fast summary cannot hide slower samples. Achieved concurrent users remain a separate required field, not inferred from sample count.
