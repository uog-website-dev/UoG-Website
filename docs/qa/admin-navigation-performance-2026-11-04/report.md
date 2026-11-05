# Admin navigation repair — 2026-11-04

Tested locally against the running Docker Django/PostgreSQL/Keycloak/Next.js
development stack using Microsoft Edge and a dedicated, authorized QA account.
The source was `e42a429d15891ded6710bb7d5739092ae7bdb76c` plus the uncommitted
working tree. This report covers navigation performance and regression checks;
it does not replace the complete P2 acceptance gate or stakeholder decisions.

## Measured navigation

Time is measured from a sidebar click until the inventory is populated, including
primary-domain cells on Sites. Baseline is warm pass 1 of `before.json`; repaired
values are the median of warm passes 1 and 2 of `final.json`. These are small local
samples, not production latency guarantees. No records were added or removed
between measurements.

| Inventory | Before | Repaired | Server Action POSTs before → repaired |
| --- | ---: | ---: | ---: |
| Organizations | 3,613 ms | 1,434 ms | 5 → 3 |
| Sites | 10,616 ms | 1,463 ms | 30 → 2 |
| Domains | 4,022 ms | 1,190 ms | 5 → 2 |

Raw first-pass and warm measurements are retained. `after.json` is an intermediate
repair. `compiler-trial.json` records a slower Turbopack trial; that compiler change
was reverted. Next retains its existing compiler. Anonymous startup warm-up moves
common route compilation earlier; first development startup still takes time.

## Changes

- Site inventory/detail responses include a read-only primary-domain summary;
  one prefetch replaces individual domain requests for every displayed Site.
- Domain inventory reads independent Sites with bounded concurrency of four,
  preserving ordering, pagination within each Site and existing permission checks.
- Shared async reads reuse matching in-flight requests during development effect
  replay. Organization tree reads use the same mechanism. Explicit reloads and
  scope changes remain fresh; there is no shared authenticated response cache.
- Development startup warms common protected routes without credentials. Backend
  authorization and Site/module boundaries remain enforced.

## Verification

Final automated results and build evidence are recorded alongside this report.
The complete backend suite passed: **654 tests** (`backend.log`,
`backend.junit.xml`). API-client **160 tests** and shared UI **89 tests** passed.
All **five TypeScript checks** passed (`typecheck-complete.log`).
Both Admin and public frontend **production builds passed** in an isolated
container (`frontend-build.log`), without overwriting the running development
applications' build directories.

The first full Admin run passed 355/356 tests; the Post create/edit test timed out
waiting for the dialog transition while other checks were running. Its unchanged
10-test Post suite passed on a separate rerun (`posts-recheck.log`). The initial
failure is retained in `frontend.log`.
The subsequent complete Admin run passed **356/356 tests across 46 files**
(`admin-final.log`), including the unchanged Post create/edit test. Together with
the API-client and UI runs, **605 frontend tests passed**. No timeout settings or
product behavior were changed to make the rerun pass.

`schema-match-final.log` confirms the validated generated OpenAPI schema matches
`docs/api/openapi.yaml`; `migration-check.log` confirms no migration is required.
Regression coverage includes API summary/null/write protection, bounded query
count, domain concurrency/order, no per-row hostname reads, and async replay,
reload and scope changes.

Intermediate logs, including a test typing correction and a shell-quoting failure
in the schema comparison command, are retained. The corrected comparison was
executed separately; those intermediate failures are not labeled as passes.

Remote CI and human review remain pending for these uncommitted changes. No
commit, push, external issue attachment or Sprint 3 approval was performed.

## Cleanup

`cleanup.json` records four disabled QA accounts, four revoked temporary grants,
three removed CMS role bindings and removal of the private session file. The
browser probe was read-only. No module settings or developer volumes changed.
Redacted HTTP records contain no passwords, live tokens or cookies.

See [developer notes](../../development/admin-navigation-performance.md) for the
implementation contract and development warm-up behavior.
