# P4-QA-003 ? Integrated CMS release review



**Automated disposition: NO-GO. Production-ready: false. Deployment authorized: false.**



This packet consolidates current regression, security and browser evidence for application candidate `63d297c` (full hash in [environment](environment.json)). It does **not** contain a signed Product Owner decision. Human Product Owner, QA, Security and infrastructure approvals are pending. The label ?QA? supplied during review is not a signature or a load-test endpoint.



## Current results



| Check | Actual result | Evidence |

| --- | --- | --- |

| Full backend regression | **1,178 passed, 2 failed, 5 skipped**, 1,185 cases | [JUnit](backend.xml), [log](backend.log) |

| Original skip closure | **5 passed** after supplying documentation and enabling private-MinIO integration prerequisites. Does not erase the original two failures. | [Supplemental JUnit](skip-closure.xml), [log](skip-closure.log) |

| Full frontend regression | **1,055 passed, 2 failed**: api-client 166 passed; shared UI 219 passed; admin 670 passed/2 failed | [Full log](frontend.log) |

| Focused frontend rerun | Both failing files passed. Initial full-suite failure remains open pending reliability triage and a clean stable full run. | [Focused JUnit](focused-frontend.xml), [log](focused-frontend.log) |

| Production builds | Admin and public builds passed in an isolated frontend checkout; development `.next` directories were not overwritten | [Exit codes](build-results.json), [admin](admin-build.log), [public](public-build.log) |

| Workspace TypeScript | Passed | [Result](typecheck-result.json), [log](typecheck.log) |

| OpenAPI | Generation/validation with fail-on-warning passed; parsed schema exactly equals committed baseline | [Result](openapi.json), [log](openapi.log) |

| Current security-name coverage index | RBAC 40, IDOR/cross-Site 68, draft exposure 43, stored-XSS/safe-rendering 45, module-disable 14 matched cases; all matched cases passed with no skips | [Cases and limitations](security-coverage.json) |

| Real-browser WCAG subset | **32 viewport scans: 18 automated passes, 14 failing scans**. All 16 public scans passed; authoring scans report contrast and accessible-name findings. | [Findings/selectors](accessibility.json), screenshots in this directory |

| 500 users / p95 load <1.5 s | **NOT RUN / BLOCKED**. QA URL, approved workload/methodology and production-like environment not supplied | [Explicit missing result](performance.json), [measurement plan](PERFORMANCE-PLAN.md) |

| Operational readiness | Responsible-team backup/restore, deployment rollback and log/monitoring evidence/review missing | [Status](operations.json), [infrastructure handoff](INFRASTRUCTURE-HANDOFF.md) |

| Gate policy tests | 13 tests pass, including fail-closed No-Go, critical/high accepted-risk rejection, stale hashes/commits, insufficient concurrency and absent approvals | [Unit log](gate-unit-tests.log), [test source](../../../../scripts/qa-release-gate.test.py) |



Security-group counts overlap and are not a code-coverage percentage or an exhaustive security assessment. Current API/service tests exercise the negative scenarios; the committed [Main walkthrough](../../main-workflow-2026-11-21/README.md) and [pilot walkthrough](../../college-workflow-2026-11-21/README.md), including [40 live two-Site HTTP cases](../../college-workflow-2026-11-21/isolation.json), provide historical real-service mutation/publication evidence. Current browser checks re-exercise public and authenticated authoring navigation, not the complete create?approve?publish workflow on a new immutable release. That E2E gap is retained in the manifest.



## Acceptance criteria disposition



| AC | Disposition |

| --- | --- |

| AC01 all committed stories traced/reviewed | **INCOMPLETE**. [Inventory](story-inventory.json) finds 25 committed identifiers, expands Post 001?007, links available PR merge metadata/tests/QA reports and leaves missing records explicit. Remote PR review approvals were not supplied or inferred from merges. Six stories lack identified QA report links; three lack local PR references. P4-PAGE-002 requires Issue reconciliation because the reusable-sidebar commit is labelled P4-PAGE-001. An authoritative sprint-board export is still required. |

| AC02 critical/high security defects resolved | **NO GO CLEARANCE**. Indexed automated negatives passed, but named Security Lead disposition and exhaustive critical/high review are not supplied. No new critical/high security vulnerability is asserted from the two foundation failures. Open findings are not silently waived. |

| AC03 unauthorized/cross-Site rejected | **AUTOMATED COVERAGE PASS** for current indexed API/service negatives; historical live HTTP matrix retained separately. |

| AC04 unpublished Pages/Posts unavailable anonymously | **AUTOMATED COVERAGE PASS** in current backend suite; Main/college committed browser workflows include real anonymous draft denials. |

| AC05 performance environment/workload/percentiles/concurrency | **BLOCKED**. Historical four-client API evidence is explicitly not 500-user proof, and prior 300 ms cached-return misses are not measurements of the new 1,500 ms target. |

| AC06 WCAG 2.1 AA remediation/exceptions | **INCOMPLETE / FINDINGS OPEN**. Automated subset recorded; [manual checklist](accessibility-manual-checklist.json), critical-route agreement and human exception/remediation disposition pending. |

| AC07 responsible-team recovery/rollback reviewed | **PENDING** infrastructure-owned artifacts and review. CMS revision restoration is not disaster recovery or deployment rollback. |

| AC08 signed Go/No-Go with risks and reviewers | **PARTIAL**. Machine gate explicitly records No-Go; [human decision form](SIGN-OFF.md) remains unsigned. No accepted risks or named approvals are fabricated. |

| AC09 No-Go does not imply production readiness | **PASS**. [Decision](decision.json) has `production_ready=false` and `deployment_authorized=false`; policy tests guard these semantics. |



## Defect register and remediation



[Structured register](defects.json) distinguishes proposed defect severity from missing-evidence release gaps. No risk has been accepted by a human approver.



- **QA-REG-001 / medium / platform foundation:** `test_application_code_does_not_name_institutional_hostnames` flags hostname text in `apps/sites/middleware.py`; `test_representative_foundation_resolves_each_site_from_data` expects `localhost` to resolve no Site, while the new DEBUG-only Main fallback returns Main. Reconcile the intended contract and tests without weakening production or unknown-host isolation. Both failures remain open.

- **QA-REG-002 / medium / admin frontend and QA:** media-picker ineligible-save feedback assertion and Builder undo/redo timeout failed in the full concurrent regression run, then passed focused rerun. Treat as reliability/triage work, not a proven exploitable application defect and not a waived full-suite failure.

- **QA-A11Y-001 / proposed medium / accessibility:** contrast findings in Page/Post authoring. Review disabled-control exemptions and manual contrast context; do not automatically mark every axe report confirmed or exempt.

- **QA-A11Y-002 / proposed medium / accessibility:** visible text is absent from accessible names on authoring controls. Fix confirmed label/name mismatches and retest speech/keyboard behavior. Axe impact is ?serious?; organizational severity and exceptions require human review.

- **Release evidence gaps:** missing approved 500-user run, infrastructure recovery/rollback/log review, named PR/code reviews, official story mapping and signed release decision. [Prior PERF-010 release gate](../../P0-PERF-010/2026-11-20/README.md) remains unresolved/requires reconciliation; this review does not clear it.



No application behavior or CMS tests were changed to manufacture a green release. Both GitHub and Azure backend CI definitions now run the release-policy unit tests before pytest; remote CI has not been triggered or claimed green by this review. This task adds review tooling, evidence and proposed dispositions. Follow-up owners must remediate/reconcile findings and collect a clean immutable-candidate run before requesting Go.



## Accessibility scope and limits



Main and college homepage, news list, article and sidebar Page were scanned at 1440?1000 and 390?1000. Authenticated Editor routes covered Page create, Post create/rich text, Media and Menus for each Site. Axe 4.14.0 used WCAG 2 A/AA and 2.1 A/AA tags; only Next.js development portals were excluded. [Tool source](https://github.com/dequelabs/axe-core) and per-rule help links are included for reproducibility.



Automated passes are not WCAG certification. Incomplete rules, gradients/media contrast, keyboard/focus order, screen readers, Builder inspector/palette/template interactions, media picker/upload and review/preview dialogs, authentication/session states and approved exception scope need manual review. Prior [renderer/keyboard evidence](../../public-layout-a11y-2026-11-12/report.md) is historical controlled-fixture evidence, not a substitute for current human sign-off.



## Operational boundaries and cleanup



The runtime was ordinary local development Docker Compose, not a production-like 500-user benchmark. Full backend/frontend regressions initially ran concurrently; their durations are not performance evidence. CPU/memory, network, services, roles and candidate commit are recorded in [environment](environment.json). Public and admin builds were compiled separately in an isolated checkout.



Two disposable Site-only Editors were created for authenticated browser review, one on Main and one on the pilot. No content was created, edited, published or reassigned by that browser review. Both identities are disabled, memberships revoked and the private credential journal removed ([cleanup](browser-cleanup.json)). Real-MinIO supplemental tests used test-database-owned unique objects and their fixture cleanup; worker functions ran directly with dispatch disabled, so these are storage/failure integration checks, not a new Celery transport certification. Existing Main/college user content and service containers were retained.



The two documentation tests were enabled by copying their matching checkout documents into the runtime container. No migration/schema change was introduced. Historical migration/compatibility tests and the current full suite are retained; infrastructure disaster recovery remains a separate owner-supplied requirement.



Evidence logs are normalized and scanned/redacted for environment secrets and JWT-like strings. Browser login/provider pages were not captured. Artifact hashes bind the review packet; signed approvals must reference its canonical digest. Do not expose private session journals or attach raw container/configuration dumps.



## Reproduce and release handoff



1. Run current backend/frontend regression and schema checks on the immutable candidate; preserve failing attempts and JUnit. Use `RUN_MEDIA_MINIO_TESTS=1` only with configured private test storage; restore fixture-owned objects only.

2. For read-only browser/axe review, install pinned tooling with `npm install --prefix .git/task-data/release-tools --no-audit --no-fund --ignore-scripts --save-exact axe-core@4.14.0`. The existing pinned Playwright harness is in `scripts/perf`. Set `UOG_QA_OUTPUT` to a new directory. Supply that directory?s `browser-targets.json` (or `UOG_QA_PUBLIC_TARGETS`) with the Main/pilot hostnames, existing article/Page slugs and navigation labels; the captured file is fixture input, not application identity logic.

3. Copy `scripts/qa-release-session.py` and the existing `scripts/sprint3_live_review.py` into backend `/tmp`. With DEBUG enabled, pipe local private configuration to `prepare`, then `refresh` and directly into `node scripts/qa-release-a11y.cjs`. Never tee the credential stream. `UOG_QA_RESUME=1` continues interrupted scans; do not use resume to hide failed findings. Always run `cleanup` and retain recovery IDs if cleanup fails.

4. Refresh [story inventory](../../../../scripts/qa-release-inventory.py), reconcile authoritative Issue/PR/review links and update reviewed test/QA mappings. The generator preserves manual mappings and does not invent approvals.

5. Populate captured factual result files, run `python scripts/qa-release-report.py --output <packet>` and then `python scripts/qa-release-gate.py --manifest <packet>/manifest.json --output <packet>/decision.json`. For this packet, **exit 1 / NO_GO is expected**. Run `python scripts/qa-release-gate.test.py` for policy regression.

6. Obtain infrastructure evidence and the approved QA load endpoint/workload, remediate findings, repeat the missing checks and obtain externally verified, named Product Owner/QA/Security/infrastructure records. [Sign-off procedure](SIGN-OFF.md) explains evidence binding and stale-approval rejection. Filling JSON fields is not identity verification.

7. Attach the packet, linked PR/CI evidence and actual signed decision to the release Issue. No Issue URL or authenticated review records were supplied here; external attachment and full Definition of Done remain pending. A deployment pipeline must consume a passing gate plus authoritative protected-environment approvals; this task does not deploy anything.

