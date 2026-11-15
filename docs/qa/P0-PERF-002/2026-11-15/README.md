# P0-PERF-002 local verification — 15 November 2026

The scoped bootstrap, shared workspace context and lazy Site switcher are implemented. Production measurement completed **131 samples with zero recorded failures** against the existing ten-Site PERF-001 dataset. **Methodology and budgets remain PROPOSED; product/QA acceptance is pending.**

## Measured improvement

| Measurement | PERF-001 | PERF-002 |
| --- | ---: | ---: |
| Workspace API p50 / p95 | 548 / 709 ms | 31 / 50 ms |
| Django requests per workspace call, median | 4 | 1 |
| SQL statements per workspace call, median | 277 | 10 |
| Cold Site-switch p95 | 2,455 ms | 1,520 ms |
| Warm Site-switch p95 | 2,342 ms | 1,014 ms |
| Dashboard usable p95 | 2,342 ms | 1,198 ms |

Workspace API p95 decreased **93.0%**; Django request count decreased **75%**, and SQL count decreased approximately **96.4%**. The measured 50 ms workspace p95 meets the **proposed** 500 ms target. There is no approved budget to claim compliance with yet. Warm switching remains slightly above its proposed 1,000 ms target; cached section return (1,138 ms) and transition (777 ms) remain above their separate proposed targets. Their underlying content-data requests remain outside this bootstrap change.

[Comparison](comparison.md), [raw production samples](production/results.json), [sanitized traces](production/traces.jsonl) and [context request inventory](context-request-inventory.json) preserve the evidence. All 20 timed Site switches have exactly one Django bootstrap; all 30 same-Site section/return/transition samples have zero bootstrap calls. Lazy discovery is separate. All 80 direct API samples have correlated Django spans. The whole run contains 753 Django spans and 693 Next upstream spans.

The direct workspace probe uses the same authenticated Next URL as PERF-001. Site switches now include opening/loading the searchable dialog, whereas the original run selected from an already populated native control. Ten samples per navigation scenario are small-sample diagnostics; nearest-rank p95 is the slowest sample. Shared host, retained server/database caches, scheduling and the changed interaction prevent attributing every latency difference solely to this implementation.

## Environment and reproduction

Use the [implementation/API guide](../../../performance/P0-PERF-002.md), [PERF-001 methodology](../../../performance/P0-PERF-001.md) and pinned `scripts/perf` harness. The same Windows 11 / Intel i7-1355U / 16 GB host, Docker Desktop WSL2 profile, two Gunicorn sync workers, Next 15.5.28 / Node 22.23.3, headless Edge 157.0.4341.46, 1440×1000 viewport and unthrottled loopback network were used. Hardware details are retained in the [PERF-001 environment evidence](../../P0-PERF-001/2026-11-15/README.md). The ordinary admin container remained stopped, as in the prior production baseline. Tests/builds were stopped during measurement.

[Dataset verification](dataset-verification.json) confirms ten Sites, each with 40 Pages, 100 Posts and 80 real private media objects. The seed retains the original taxonomy/menu fixture and 20% published Page/Post distribution. The generated actor had ten Site Administrator grants and no organization/platform grants. Each timed navigation pair uses an independent real Keycloak login, excluded from timings. [Seed output](seed.txt), [production build events](production/build-events.txt), source hashes in raw results and the final source manifest identify the run. No database migration is introduced.

```powershell
./scripts/perf/run.ps1 -Mode production -Samples 10 -Output docs/qa/P0-PERF-002/local
node scripts/perf/compare-workspace.cjs docs/qa/P0-PERF-001/2026-11-15/production/results.json docs/qa/P0-PERF-002/local/production/results.json
```

`scripts/perf/workspace-check.cjs` accepts the same private prepared session on stdin; `PERF_CHECK_OUTPUT` selects its public JSON result path. Never tee the private input or record raw authentication headers/logs.

## Tests and browser evidence

- [Full frontend output](frontend-full.txt): **572 passed**, 80 files. [Final focused JUnit](frontend-focused.xml): **31 passed**, covering the final instrumentation/switcher changes, desktop/mobile request sharing, same-Site reuse, cancelled/late responses, malformed context, recovery, lazy paging/search and preserving unsaved input during successful focus revalidation.
- [Backend focused JUnit](backend-focused.xml): **37 passed**, covering bootstrap/query contracts, unknown/foreign/anonymous access, revoked/expired memberships, disabled users/roles/permissions, module gates/version changes, stable Site search pagination, bulk permission parity for Site/organization/platform scopes, authorization regressions and OpenAPI.
- [Broad backend report](backend-regression.xml): **498 CMS cases passed, one skipped**. The wider initial invocation also contained two test expectation failures: comparing unique request IDs as though identical, and the old OpenAPI route allowlist loaded before its update. Both are resolved in the final 37-test focused run. A subsequent fixture dependence on migrated module seed data was made explicit/self-contained for reused test databases. The initial report is retained; these are not open product defects.
- [Real browser check](browser-check.json): **PASS** for one shared initial bootstrap, no eager discovery, one new bootstrap per Site selection, direct-link refresh, unknown-Site denial, hiding prior Site context after injected 502, and successful explicit retry. Production samples additionally traverse ten Sites and Pages/Posts/Menus.
- [TypeScript](typecheck.txt), [Django system/migration checks](django-checks.txt), production build and OpenAPI validation passed. The [OpenAPI baseline](../../../api/openapi.yaml) includes both new authenticated endpoints; no drift or migration is pending. [Harness tests](harness-tests.txt): three passed.

## Acceptance coverage and remaining approval

| Criterion | Evidence |
| --- | --- |
| AC01 | Versioned minimal response/schema, no discovery call in bootstrap test, bounded query-count assertion |
| AC02 | Separate bounded/searchable switcher API and lazy browser/component checks |
| AC03 | Shared provider, desktop/mobile single-fetch test, 50-navigation trace inventory |
| AC04 | Live canonical authorization snapshot, scope/parity and revocation/expiry/inactivity tests; uniform denial shape |
| AC05 | Direct links/refresh/browser retry, stale-response cancellation and schema/Site validation tests |
| AC06 | Same-endpoint p95 comparison and request/SQL reductions; proposed target met, approved-budget acceptance pending |
| AC07 | OpenAPI baseline, typed client payload and API/frontend contract tests |

[Secret scan](secret-scan.json) found zero matches against generated credentials, configured secrets and JWT patterns in collected evidence. [Cleanup](cleanup.json) disabled the generated account, revoked its ten memberships, removed its private session and retained the reusable dataset. Only isolated measurement services were stopped. Ordinary application services were not restarted or deployed.

Product/QA approval of methodology/budgets, external code review, PR and Issue attachments remain pending. Deploy backend and rebuilt admin together because the workspace response schema changed. Remaining cached-section/warm-switch budget overruns are visible findings rather than waived targets.
