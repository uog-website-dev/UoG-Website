# P0-PERF-010 release verification

The release suite checks production navigation speed and authorization together. Passing a timing run does not authorize release: the gate also requires passing regression evidence and named QA and Security approval of its exact manifest hash. Current budgets are proposed, and no approvals are prefilled.

## Run the suite

Use the isolated perf services and managed PERF001 fixtures. Do not run fixture creation or role/module fault injection against production data. The seed requires DEBUG in the management shell, creates a disposable Keycloak identity with Site-only memberships, and uses 21 Sites with 40 Pages, 100 Posts, 80 media records and four menus each. Existing fixtures are reused.

From the repository root, with Docker and local Edge available:

```powershell
powershell -File scripts/perf/run.ps1 -Mode production -Sites 21 -Samples 30 -SectionMatrix -DashboardProbes -Output docs/qa/P0-PERF-010/local/final
powershell -File scripts/perf/release-check.ps1 -Output docs/qa/P0-PERF-010/local/browser-final
```

Keep performance measurements sequential and free of competing builds, tests or load generators. Record hardware, Docker CPU/memory, browser version, network profile and any contention. Run development attribution separately; never substitute it for the production release baseline. First process visit has one observation and is diagnostic, not a p95 population.

The isolated gateway serves the browser root favicon probe through the existing admin icon, matching the normal gateway's public icon behavior. A favicon 404 is not suppressed by the benchmark.

The browser suite signs in through real Keycloak and exercises workspace bootstrap, discovery, rapid Site switching, delayed stale responses, live membership revocation, unsaved-draft confirmation, all four section returns, dashboard partial failures, module disabling, read-BFF privacy, browser history, session loss, API retry and forged cross-Site object IDs. Fault injection is limited to managed fixtures and is restored in finally blocks. A failed suite returns a nonzero exit code and records its phase without saving credentials or private bodies.

Read counters include the PERF-008 authenticated GET BFF and legacy read RPCs. The dashboard fault tests intercept GET resources, so the tests cannot pass merely because Server Actions disappeared. A first dashboard read may already be cached; only its immediate repeat is required to hit Redis. Both states remain in the raw measurements.

## Collect regression and load evidence

Run the backend pytest suite with JUnit output, frontend tests/typechecks and production builds, OpenAPI generation and baseline comparison. Use the existing `api-load.py` through the development management shell against perf-backend. It reconciles Page/Post dashboard counts independently against database aggregates for all 21 Sites, then executes 420 reads across seven endpoints with four concurrent clients. It checks Site ownership, pagination and SQL timing headers. It is a bounded read-load test, not a sustained capacity or denial-of-service certification.

Never tee `prepare-session.py` stdout: it contains credentials. Pipe private configuration into the helper and its output directly into the browser driver. Do not upload .env, private sessions, storage keys, OAuth traces or raw provider logs. Preserve redacted failures alongside successful reruns.

Store canonical evidence names under one dated directory: `final/production/results.json`, `browser-final/*.json`, `full-backend.xml`, `frontend.xml`, `bundles.json`, `api-load.json`, `service-health.json` and `openapi.json`. Then run:

```powershell
python scripts/perf/collect-release-evidence.py docs/qa/P0-PERF-010/local
node scripts/perf/release-gate.cjs docs/qa/P0-PERF-010/local/final/production/results.json docs/performance/release-policy.json
```

The collector hashes artifacts into `manifest.json` and fails when required evidence is missing or failed. A failure in the full backend run can be reconciled only by a passing focused rerun of that exact test, with no failures in that rerun; both XML files and the resolved test ID remain in the manifest. MinIO opt-in results are required separately. Load API p95 is checked against the same proposed 400 ms list and 500 ms workspace/dashboard ceilings. The candidate gate recomputes nearest-rank p50/p95 from raw samples, requires 30 samples per required scenario, verifies production mode and correlation, and checks scoped duplicate GET counts. Cached returns and Site switches allow zero repeated identical data/bootstrap GETs per navigation. Searchable Site discovery may require multiple distinct searches or pages and is recorded separately; it is excluded from that duplicate ceiling. The benchmark searches by fixture name when a target is outside the first switcher page. This excludes code/RSC traffic; inspect the recorded waterfall separately.

The p50 ceilings currently equal the existing proposed p95 ceilings. The new first section navigation ceiling is 1000 ms. These choices are provisional until Product/QA approve the method and values; they do not create an approval by themselves. Budget failures must be investigated rather than waived by relabeling the run or raising limits silently.

## Release approval

QA and Security review the full evidence, defect dispositions and baseline comparison. They record their names, approval timestamps and the SHA256 of the reviewed manifest in `release-policy.json`; Product/QA also approve the methodology and budgets. Run the final gate with:

```powershell
node scripts/perf/release-gate.cjs results.json docs/performance/release-policy.json --release --evidence manifest.json
```

The release check rejects missing approvals, mismatched build commits, substituted benchmark hashes and failed or absent browser/backend/frontend/build/load/health/OpenAPI evidence. It checks recorded attestations; repository review and environment protection remain the human trust boundary. Configure required reviewers for the `performance-release-review` GitHub environment. The manual Performance release evidence gate workflow downloads the trusted run's `performance-release-evidence` artifact and enforces the same policy. It does not deploy or generate approvals.

Regular GitHub/Azure frontend CI runs the harness regression tests in addition to existing builds and bundle budgets. Full production benchmarks remain opt-in for a controlled environment so shared CI runner noise cannot be presented as accepted performance evidence.

## Cleanup and recovery

Run `scripts/perf/cleanup.py` in the development management shell with private configuration on stdin. Verify the generated principal is disabled, all 21 memberships revoked and its private session removed. Retain the representative dataset for repeatability. Stop only perf-admin, perf-backend and perf-gateway; leave ordinary services as found. If a fault test is interrupted, inspect its managed membership/module restoration and restore those fixtures before rerunning. Never apply a blanket role or module update.

[Current evidence and acceptance matrix](../qa/P0-PERF-010/2026-11-20/README.md)
