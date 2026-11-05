# Central module management implementation audit

Story: centrally enable/disable implemented modules for individual, selected,
all/filter-matching and Organization-owned Sites. Audited against the supplied
story starting 2026-11-04 and completed 2026-11-05 (Africa/Nairobi), using the current uncommitted working tree. This report is
separate from P2-QA-GATE-001 and does not synthesize stakeholder approval.

## Current verification

- Complete backend: **682 passed** (`backend-full.log`, `backend.junit.xml`).
- Complete frontend: **630 passed** — Admin 381, API-client 160, UI 89 (`frontend-full.log`).
- TypeScript: **5/5 workspace checks passed** (`typecheck.log`).
- Production builds: **Admin and public applications passed** in a disposable build container (`frontend-build.log`); live development build directories were preserved.
- Live browser: **6/6 checks passed** (`browser-results.json` and screenshots), using real Keycloak sessions and the live applications.
- Existing database: migration `sites.0009_module_integrity` applied successfully using the migration role; no model/migration drift.
- OpenAPI: schema generation/validation passed; updated snapshot is `docs/api/openapi.yaml`.

## Findings repaired

| Finding | Repair and regression evidence |
| --- | --- |
| Completed retries failed once their preview expired. | Check actor/key/request replay before applying expiry to a new operation. Regression verifies no duplicate state changes or transition audit events. |
| Preview only signed outcome labels; valid dependency/configuration/Site edits could retain the same labels. | Bind versions, assignments/settings, registry schemas, shipped capabilities and dependency edges to the signed snapshot. Same-outcome changes now conflict. |
| Individual services validated before acquiring the bulk operation's common guard. | All supported switches and registry/API row locks acquire the same guard first. Simultaneous individual enable/disable attempts cannot break dependencies. |
| Database writes could bypass dependency and archived-Site checks; dependency cycles could be configured. | New `sites.0009_module_integrity` guards all module/dependency/assignment writers and enforces cycle, dependency and archived-switch integrity in PostgreSQL. Model/admin validation provides readable errors. |
| A globally disabled requirement did not remove its dependents from effective module availability. | Availability follows transitive dependencies while retaining assignments/content; restoration is tested. |
| Eligible counts ignored required settings and dependencies. | Summary evaluates per-Site eligibility using the same rules and batched state reads. |
| Rejected body validation and preview denials were not consistently recorded. | Central error handling writes sanitized durable rejections after rollback, including authorization failures; tokens/raw bodies are excluded. |
| Individual service switches could omit audit records. | Shared transactional service writer is used by bulk, individual HTTP and Django admin operations; repeated no-op enables do not duplicate transition events. |
| An uncertain frontend retry could reuse its key with edited reason text. | Preserve the submitted request and lock confirmation fields for uncertain retries. Clear it for definitive rejection or a new preview. |
| Unknown/conflicting scope fields and unknown module filters could be ignored. | Reject them explicitly; repeated query values remain typed validation errors. Operation history has a deterministic tie-breaker. |

## Acceptance coverage

| Criteria | Coverage |
| --- | --- |
| AC-01 individual, AC-02 selected, AC-03 all | Authenticated central API scope/preview/apply tests and individual switch contract tests. |
| AC-04 Organization direct/descendants | Backend-resolved hierarchy tests plus frontend scope-selection tests. |
| AC-05 eligibility | Planned, unshipped, deprecated, globally disabled, settings and dependency blockers; accurate eligibility summaries. |
| AC-06 unauthorized | Real permission-registry API tests, direct service denial, anonymous denial and live Site-admin UI denial. |
| AC-07 retained content | Existing API workflow tests publish a Post, disable, deny management/public delivery, restore and verify retained content/publication state. |
| AC-08 dependencies | Explicit multi-module ordering, missing/required-by blockers, model/SQL cycles, direct-write protection and transitive availability. |
| AC-09 idempotency | Replay, differing request/key rejection, completed replay after expiry and exact frontend retry body. |
| AC-10 concurrency | Competing bulk applies, simultaneous individual switches, stale Site/dependency/schema snapshots and all-or-nothing rollback/audit failure. |
| AC-11 history/audit | Append-only SQL history, actor/operation/Site/state/reason/correlation and rejected-operation sanitization. |
| AC-12 integration | Shared SiteModule state, effective availability, Site settings/navigation and frontend refresh tests. |
| AC-13 public enforcement | Actual DRF public endpoint tests confirm disabled Posts are unavailable and restoration preserves published content. |
| AC-14 regression | Full suite, typecheck, production build, migration and OpenAPI results are attached alongside this report. |

## Environment and remaining release evidence

The live local stack has `DEBUG=True` and
`ORGANIZATIONS_DEV_WRITES_ENABLED=False`. This audit preserves that approved
write policy. Live browser checks therefore cover registry, selection/preview,
history, responsive/keyboard behavior and Site-only access; they do not claim a
successful live bulk-apply/publishing journey. The automated PostgreSQL-backed
HTTP suite exercises writes with the explicit development opt-in in its isolated
test environment. A complete live rollout/publish/disable/restore acceptance run
on an approved writable QA environment remains required before story sign-off.

The existing environment was upgraded with the configured migration role.
The runtime role correctly rejected a DDL attempt; its failed log is retained.
No developer volumes were deleted. Fresh PostgreSQL test-database migration is
part of the complete pytest run (no reused test database).

Initial evidence is retained: the first focused run found a stale fixture Site
instance in a new test and an existing audit-failure injection hook that needed
preservation. Both were corrected. The initial keyboard probe incorrectly
expected arrow focus to activate a manually activated tab; the corrected probe
uses ArrowRight followed by Enter. Historical failures are not relabeled.
An intermediate browser run timed out loading the Site inventory; the final
complete run passed on unchanged product source. Its separate results and
screenshot are retained under `second-*`.

Cleanup disabled all four dedicated QA accounts, revoked four temporary grants,
removed three temporary CMS bindings and deleted the private credential/session
file (`cleanup.json`). No module switches, content or developer volumes changed
during live browser verification. HTTP records are redacted and screenshots do
not contain passwords, live tokens or cookies.

Remote CI links, PR/commit links and genuine QA Lead/Technical Lead approvals
remain pending. No commit, push, external issue update or approval was performed.

Contracts: [developer guide](../../development/central-module-management.md),
[OpenAPI](../../api/openapi.yaml), [error catalog](../../api/error-catalog.md).
