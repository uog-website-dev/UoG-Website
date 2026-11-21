# P0-PERF-010 release verification evidence

Release authorization is withheld. This packet records the production benchmark, browser/security regressions, API load, contract repairs and unresolved acceptance items. Proposed budgets are enforced as diagnostics; named Product/QA methodology approval and QA/Security release sign-off are not supplied by automation.

Cached Pages, Posts and Menus fail the proposed 300 ms return ceiling: p95 is 324, 317 and 326 ms respectively. Pages and Posts also exceed the provisional p50 ceiling. [Final budget results](budgets.md) show all metrics. All critical duplicate-read checks pass. The slow cached-return samples have zero correlated Django requests and SQL statements; the remaining delay is in the Next/client navigation path, whose precise cause needs profiling. Functional evidence collection passes, but that does not override these timing failures. Further navigation/render profiling and remediation are required before performance acceptance.

## Environment and inputs

The measured runtime is the PERF-009 branch after merging main at `664f644`. This task changes the harness, CI, contract inventory, generated schema and isolated gateway configuration; it does not change CMS application authorization or cache behavior. See `source.json` for working-tree hashes and `environment.json` for Docker resources and hardware. Run again on the final immutable release commit before approval.

The real-service stack uses production Next.js, two Gunicorn workers, PostgreSQL, Redis, Keycloak, private MinIO and Celery. Edge runs headless at 1440Ãƒâ€”1000 with loopback network and no CPU throttling. The scoped disposable Site Administrator has memberships on 21 managed Sites, with 40 Pages, 100 Posts, 80 media records and four menus per Site. The ordinary public frontend/nginx services were not started; public compilation and API regressions are separate from an end-user public deployment walkthrough.

Final navigation measurements run after regression/build jobs finish. Server/database caches are retained by the documented cold definition; each navigation pair starts with a fresh browser/router context and real sign-in, excluding login time. First process visit is diagnostic only. The benchmark includes 30 repetitions and all four cached section returns. A separate four-client load run follows navigation measurement, not concurrently.

## Acceptance matrix

| Criterion | Evidence and interpretation |
| --- | --- |
| AC01 navigation matrix | `final/production/results.json`, raw waterfall and correlated spans; cold/warm switches, dashboard and Pages/Posts/Menus/Media returns |
| AC02 percentile and duplicates | `gate-candidate.json`; raw-sample p50/p95, 30-sample minimum and zero duplicate critical scoped GETs; budgets remain proposed |
| AC03 recovery | `browser-final/switch.json`, `workspace.json`, `dashboard.json`, `recovery.json`; delayed/failed responses, live revocation, history, direct links and session loss. Backend OIDC tests cover expired JWTs |
| AC04 isolation | `browser-final/isolation.json` rejects foreign Page/Post/Menu/Media IDs on reads and writes and compares unchanged source objects; cache and membership regression suites cover role and stale-response boundaries |
| AC05 mutations and drafts | Live Page edit invalidates cached list and restores the fixture through another revision; unsaved cancel/discard verified. Component/service suites cover create, revision-bound publish, deletion success/conflict and domain-scoped invalidation |
| AC06 scale correctness | `api-load.json`; independent Page/Post counts reconciled for all 21 Sites, plus 420 reads over seven endpoints with SQL count/time and bounded pagination |
| AC07 build and health | `bundles.json`, `public-build.txt`, `service-health.json`, `comparison.md`; admin/public production builds, scoped health checks, SQL and network evidence |
| AC08 regressions | Backend XML and focused rerun, opt-in MinIO XML, admin XML and shared frontend output; see exact counts and skipped checks below |
| AC09 approval | `manifest.json` hashes the evidence. QA/Security approval, methodology acceptance and external Issue/PR attachment remain pending |

## Regression results

The full backend run collected 1183 tests: 1177 passed, one failed and five skipped. Its one failure was the stale endpoint inventory; the corrected documentation module passed all 14 tests in a focused rerun. All three opt-in MinIO tests then passed against the local private service. Two source-documentation checks remain skipped because those documents are outside the backend runtime mount. Both original and rerun XML are retained; the manifest lists the exact resolved failure rather than replacing the original result.

Admin tests passed 666 cases; shared API-client/UI suites passed 385 more. Eleven JavaScript harness tests and three Python collector tests cover percentile calculation, redaction, trace attribution and fail-closed release policy. Admin/public production builds and route bundle ceilings pass. OpenAPI validates without warnings and matches the regenerated baseline.

All eight browser/API groups have passing final per-check artifacts. `browser-final/final-status.json` summarizes them. The original suite exit and failed recovery selector attempt remain recorded; the focused recovery rerun uses the application's actual Try again control. This is not represented as a single initially green execution.

## Defect dispositions

| Local reference | Defect | Disposition |
| --- | --- | --- |
| D01 | Main's schema baseline and exact endpoint test inventory omitted author selectors, homepage apply and canonical-domain changes | Fixed generated baseline and added endpoint/method/auth assertions; validated schema and 14-test rerun pass |
| D02 | Dashboard benchmark incorrectly required a cold Redis miss despite retaining server caches | Fixed first-read assumption; immediate repeat must still be a hit |
| D03 | Older browser counters and dashboard failure injection observed Server Actions only after GET BFF migration | Fixed to count/intercept actual scoped GETs; reruns verify zero return reads and independent dashboard failures |
| D04 | Isolated gateway returned 404 for browser root favicon probes, unlike the normal public gateway | Added exact root-icon proxy to existing admin icon; nginx syntax and HTTP 200 verified; failed requests remain fatal |
| D05 | Benchmark could not select Site 21 outside the first switcher page | Wait for discovery and search by fixture name when off-page; searchable discovery remains included in timings |
| D06 | Cached Page/Post/Menu returns miss the proposed 300 ms ceiling | OPEN; gate fails. Profile the Next/client transition path; zero repeated scoped reads were observed |

These are local dispositions, not fabricated tracker links. Release performance misses, if present in `gate-candidate.json`, remain open and are not waived by the fixes above. No new critical/high authorization or data-integrity defect was observed in the exercised checks; that does not constitute Security approval.

## Measurements and limitations

[Production comparison](comparison.md) compares the earlier PERF-009 sample with this final run. It is not an isolated causal speedup: main added homepage, branding, SEO and editorial features, and the earlier run used ten navigation repetitions. The gate uses this run's raw data, not the comparison summary.

Failed rehearsals remain under `rehearsal`, `favicon-rehearsal` and `discovery-rehearsal`. The initial rehearsal overlapped regressions and stopped on the Redis assumption. Later rehearsals exposed the favicon route and off-page discovery limitations. None is presented as release acceptance. Search/pagination discovery calls are retained in waterfalls; duplicate limits apply to data/bootstrap GETs, not legitimate discovery pages.

API probes use the disposable managed account. Product BFF checks separately verify cookie authentication, HttpOnly session handling, token-field absence, private/no-store responses, hostile-Origin denial and anonymous/foreign-Site rejection. No secret configuration or private response bodies belong in this packet.

## Review and operations

Use the [runbook](../../../performance/P0-PERF-010.md) to reproduce, collect artifacts and execute the gate. Review `manifest.json`, `gate-candidate.json` and `gate-release.json` together. The manual CI gate cannot authorize release while policy/sign-off fields remain unapproved. Configure the protected review environment and attach the reviewed artifacts to the actual Azure DevOps Issue/PR; no Issue URL or reviewer authorization was provided in this session.

After measurement the temporary principal is disabled, its 21 memberships revoked and the private session removed. Managed datasets remain reusable. Only isolated perf services are stopped; ordinary service state is preserved. `cleanup.json` records the actual result. No migration or application deployment is introduced by this task.

