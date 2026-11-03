# Sprint 2 remediation backlog before Sprint 3

Prepared: **2026-11-03**. Parent gate: **P2-QA-GATE-001**.

These are proposed backlog references, not existing Azure DevOps work-item IDs.
Link actual implementation work items to the parent gate when creating them.
Sprint 3 readiness remains **NO-GO** until the acceptance gate is satisfied.

## Evidence and current status

- [Acceptance report](report.md) and [defect register](defects.md) contain the
  original real-stack findings on build `cd704d3`.
- The 3 November backend rerun records **627 passed, 0 failed, 2 skipped**;
  the obsolete route-inventory assertion has been corrected. The two skipped
  documentation checks still need execution with the repository docs available.
- Local frontend changes address menu inheritance handling and related tests.
  They are work in progress, not evidence that the full frontend/typecheck gate
  has passed. Preserve and validate them rather than replacing them.
- Security, module administration, permission inspection, logout, access UI,
  draft/public coexistence and fresh-stack acceptance need closure evidence.
  A green unit suite does not supersede the observed live security failure.

## Work order

| Proposed reference | Story | Priority | Defect / cases | Suggested owner | Dependencies |
| --- | --- | --- | --- | --- | --- |
| P2-HARD-001 | Enforce database-backed CMS authorization | P1 — first | QA-SEC001; T15–T17, T35 | Backend / IAM | None |
| P2-HARD-002 | Make module administration transactionally safe | P1 | QA-D001; T10–T11 | Backend | None |
| P2-HARD-003 | Repair effective-permission inspection | P1 | QA-D002; T15 | Backend / IAM | None |
| P2-HARD-004 | Restore functional access-management UI | P1 | QA-D004; T13 | Frontend / IAM | P2-HARD-003 |
| P2-HARD-005 | Reconcile Keycloak logout configuration | P1 | QA-D003; T12 | Identity / Infrastructure | None |
| P2-HARD-006 | Close frontend and regression release failures | P1 | Remaining QA-D005; T37 | Frontend / QA | Coordinate with P2-HARD-004 |
| P2-HARD-007 | Validate or implement published-content draft editing | P2 — gate gap | QA-GAP001; T23 | CMS / Technical Lead | Approved workflow decision; P2-HARD-001 |
| P2-HARD-008 | Repeat integrated acceptance on fresh and existing stacks | Release gate | T01–T38, especially T38 | QA / DevOps | P2-HARD-001 through P2-HARD-007 |

P1 findings must be resolved before gate approval. P2-HARD-007 may only be
excepted if formally classified noncritical and explicitly approved under the
gate policy. Security, cross-Site isolation and module enforcement have no
exception path in this gate.

## P2-HARD-001 — Enforce database-backed authorization across CMS

**As a** Platform Administrator and security owner,  
**I want** every protected CMS operation authorized by registered database
permissions and Site assignments,  
**so that** identity-provider claims cannot grant access to another Site.

### Problem and scope

A genuine Keycloak token carrying `platform-admin` allowed a Site A Viewer to
read and create Site B Pages without a platform or Site B database assignment.
Review the confirmed Page bypass and related CMS workflow/revision shortcuts.
Check Posts and Menus for the same pattern; do not assume they share the defect.

Use the common authorization contract and resolve ownership from persisted
resources. Keep existing publication rules and separation of duties. Do not
introduce a staff/superuser flag bypass, token-role fallback or public admin mode.

### Acceptance criteria

- A valid signed token authenticates identity; its realm roles alone confer no
  application management permission.
- Site A-only users cannot list, retrieve, create, edit, move, delete, review or
  publish protected Site B records, including through manipulated URL/body IDs.
- A realm-role-only `platform-admin` principal without the required database
  assignment receives the approved 403/404 response, with no mutation committed.
- Legitimate, active platform and Site grants continue to authorize their
  registered operations; inactive, expired and revoked grants are denied.
- CMS roles and application permissions follow one documented approved mapping;
  no parallel authorization path silently broadens scope.
- Author/reviewer separation, workflow transitions and public publication
  isolation remain enforced.
- Unit/transaction tests and a real Keycloak + PostgreSQL HTTP regression
  reproduce the original principal/grant disagreement and prove its rejection.
- Permission and error descriptions in OpenAPI match actual enforcement.

**Required evidence:** redacted before/after HTTP results, principal/scope proof,
negative-test output, relevant audit evidence and linked PR/CI result.

## P2-HARD-002 — Make module activation and deactivation transactionally safe

**As a** Platform Administrator or authorized Site Administrator,  
**I want** module configuration changes to commit atomically,  
**so that** Pages, Posts and Menus can be enabled or disabled reliably.

### Problem and scope

Global module PATCH and Site module enable/disable returned 500 because
`select_for_update` ran outside a transaction. Correct the complete mutation
boundary, including lock acquisition, version validation, save and applicable
audit. Preserve the approved global/per-Site registry rules.

### Acceptance criteria

- Authorized global activation and Site enable/disable requests return the
  documented success response without transaction-management errors.
- First-time enablement and re-enablement work for shipped, globally enabled
  modules; planned/unshipped capabilities remain unavailable.
- Locking, concurrency checks and writes share the required transaction and
  serialization boundary; stale/concurrent changes fail predictably.
- Disabling a module retains its content/configuration and blocks the module's
  content mutations and public delivery according to policy. Approved
  administrative inspection is distinguished from content editing.
- Disabling a module on Site A does not alter Site B's independent setting.
- The authorized management operation can turn a disabled module back on.
- Scope checks, validation and audit failure cannot leave partial state.
- Tests exercise real HTTP/autocommit or transaction-mode PostgreSQL execution;
  a test fixture's surrounding transaction must not conceal the original defect.

**Required evidence:** global and per-Site API results, concurrent/stale-write
tests, module-off API/UI checks, retained-row checks and linked PR/CI result.

## P2-HARD-003 — Repair scoped effective-permission inspection

**As a** Platform Administrator or authorized user,  
**I want** effective permissions returned for a validated scope,  
**so that** assignments can be inspected accurately and safely.

### Problem and scope

The assignment-specific effective-permission route returned 500 for Editor,
Reviewer and Viewer because `get_object_or_404` was undefined. Repair that route
and its input/authorization handling, rather than substituting tests of a
different self-permission endpoint.

### Acceptance criteria

- The reported route returns 200 and registered effective permissions for an
  authorized target user and valid Site/Organization/platform scope.
- Results respect active roles, permission status, assignment expiry/revocation
  and the approved platform-administrator policy.
- Site/Organization identifiers are resolved and checked for consistent
  ownership; invalid scope combinations return standard validation errors.
- Unknown users/resources and malformed identifiers fail predictably without
  NameError, SQL disclosure or unhandled 500 responses.
- Unauthorized inspection of another user or foreign scope is denied without
  disclosing protected permission/assignment data.
- Request/response schemas and error responses document the actual route.
- Route-specific tests cover positive roles, missing users, bad IDs, foreign
  scopes, revoked grants and direct authenticated HTTP use.

**Required evidence:** scoped role matrix, real API output, negative tests,
OpenAPI reference and linked PR/CI result.

## P2-HARD-004 — Restore functional Site access management in Next.js

**As a** Platform Administrator or authorized Site delegator,  
**I want** the access-management UI to show actual grants and manage permitted
Site assignments,  
**so that** administrators can complete IAM tasks without direct API calls.

### Problem and scope

An authenticated database-granted administrator saw empty permissions/role
tables even though assignment APIs succeeded. Investigate the active page,
BFF/server actions, token forwarding, response contracts and error states.
The cause is not assumed to be identical to the backend effective-route defect.

### Acceptance criteria

- A real authenticated administrator sees the correct registered permissions,
  roles and assignments returned by Django for the selected scope.
- An empty state appears only after a successful empty response. Backend errors,
  authentication failures and malformed payloads are shown as actionable errors,
  with correlation IDs where available.
- An authorized operator can create and revoke permitted Site assignments and
  see the refreshed effective state; self-escalation and foreign delegation fail.
- Editor, Reviewer and Viewer displays/actions follow the approved registry.
- Protected access tokens remain server-side under the approved session design.
- Active server-action imports and typed response contracts are consistent;
  unsupported actions do not silently fall back to fabricated empty data.
- A real Next.js/Keycloak/backend browser test completes assignment management,
  not merely page loading, with meaningful assertions and screenshots.

**Required evidence:** actual browser assignment/revocation workflow, role/scope
matrix, redacted API/error evidence, frontend tests and linked PR/CI result.

## P2-HARD-005 — Reconcile and verify Keycloak sign-out on existing deployments

**As an** authenticated platform user,  
**I want** sign-out to end the application and Keycloak sessions and return to
an approved page,  
**so that** I can leave the platform safely and predictably.

### Problem and scope

Existing runtime `admin-web` post-logout URI configuration used `+` between
entries, while the repository realm definition used `##`. Real sign-out reached
Keycloak's “Invalid redirect uri” page. Reconcile existing installations as well
as fresh imports; preserve data and the approved redirect allowlist.

### Acceptance criteria

- Approved client logout URI settings are valid and reconciled idempotently on
  both existing and newly deployed realms.
- Real authorization-code sign-in, application session creation and sign-out
  complete through the configured Nginx/Next.js/Keycloak routes.
- Sign-out clears the local application session and completes the intended IdP
  logout; the user returns to the approved signed-out destination.
- Protected pages require authentication afterward; re-login follows the
  intended SSO policy rather than accidentally retaining the old session.
- Unapproved callback/logout destinations remain rejected; no unrestricted
  redirect wildcard is introduced as a workaround.
- Missing/expired session tokens and failed IdP responses are handled safely.
- Reconciliation creates no duplicate clients/users and logs no credentials.

**Required evidence:** fresh/existing configuration comparison, actual browser
login/logout/session checks, redirect negative tests and linked PR/CI result.

## P2-HARD-006 — Close remaining frontend and regression release failures

**As a** developer and QA Lead,  
**I want** reproducible backend, frontend and type checks to pass,  
**so that** the release gate can rely on automated regressions.

### Problem and scope

The backend route-inventory failure has been corrected and the recorded rerun
is 627 passed with two documentation skips. Remaining recorded failures are
Admin frontend tests/typecheck. Menu inheritance fixes are already in the
working tree and require validation. Distinguish stale test fixtures from real
implementation defects rather than deleting checks to produce a green result.

### Acceptance criteria

- Validate the current menu-inheritance/action fixes against actual backend
  response shapes and compatible test fixtures; missing/malformed values do not
  produce unhandled component exceptions or hide backend failures as success.
- Resolve the remaining Admin action-export, footer-prop, Post-query and content
  preview typing failures identified in the recorded typecheck output.
- Full backend, Admin frontend, shared UI and API-client suites pass with zero
  unhandled test errors. The corrected workflow-history route remains present.
- Documentation-contract tests execute with the docs tree available, or any
  noncritical skip is explicitly justified and approved under gate policy.
- Full frontend typecheck and a production build pass in an environment isolated
  from the running development `.next` output.
- Relevant browser regressions run against real services; caches, mocks or HTML
  simulations are not substituted for integrated acceptance evidence.
- CI runs the required commands on the reviewed revision and publishes reports
  and schema validation. No failing security test is removed, weakened or marked
  skipped merely to unblock the pipeline.

**Required evidence:** complete fresh test/typecheck/build output, automated
reports, CI run URL/revision, skip decisions and linked PR. Previous failure
counts are historical until a new complete run replaces them.

## P2-HARD-007 — Establish safe draft editing alongside a live publication

**As a** Site Editor and Publisher,  
**I want** to edit a new draft while visitors continue seeing the last approved
publication,  
**so that** updates can be reviewed without exposing unfinished content.

### Decision gate and scope

Direct PATCH of a published Page returned 400 and the public snapshot stayed
stable. That is safe rejection, but did not demonstrate T23's draft-editing
workflow. First identify the approved P0/CMS revision model and supported API
sequence. If it already exists, document and test it; otherwise implement the
smallest approved working-copy/publication mechanism.

Do not make published content freely mutable to satisfy this test, invent a
parallel CMS/news domain, or treat a blocked test as a passed scenario.

### Acceptance criteria

- Technical Lead records the approved draft/publication contract, entry points,
  workflow states and permission mapping before introducing a new data model.
- An authorized Editor can create/open and edit a working draft for a published
  Page through the documented user/API workflow.
- Until an authorized reviewed publication occurs, public APIs, navigation and
  Next.js rendering keep serving the previous approved content and metadata.
- Draft submission, independent review/approval and publication follow the
  existing workflow and separation-of-duties rules.
- Successful publication changes public content atomically and invalidates the
  correct Site cache/version; concurrent or stale actions fail safely.
- Unpublish/archive and failed publication behavior are explicit and tested.
- Draft/history data is scoped and audited; foreign users cannot inspect or
  publish it. Shared Post publishing behavior does not regress.
- Schema, migrations and APIs are updated only where required by the approved
  implementation. Existing content upgrades without losing published snapshots.

**Required evidence:** approved decision, T23 browser/API sequence, publication
isolation/concurrency tests, migration evidence if applicable and linked PR/CI.

## P2-HARD-008 — Repeat and sign the Sprint 1–2 integrated acceptance gate

**As the** QA Lead, Technical Lead and Product Owner,  
**I want** the complete acceptance workflow verified on the repaired platform,  
**so that** Sprint 3 starts on an accepted institutional and publishing foundation.

### Scope

Re-execute P2-QA-GATE-001 after remediation. Use the real Django/DRF backend,
PostgreSQL, Keycloak and Next.js applications. Use at least two independent Sites
and one continuous Organization → Site → Domain → Modules → Assignments →
Pages/Posts/Menus → Review → Publish → Host resolution → Render → Isolation →
Disable → Audit workflow.

### Acceptance criteria

- All 38 cases have current build/date/tester, expected/actual result, status,
  evidence and defect reference where applicable. Historical results are not
  silently relabeled as current passes.
- The continuous workflow completes without direct model switches or privileged
  fixture workarounds replacing the management operations being assessed.
- A fresh isolated stack and an upgraded existing environment both deploy,
  migrate and repeat the workflow; existing developer volumes are not destroyed
  to simulate a fresh install.
- Authentication, authorization, cross-Site isolation, module enforcement and
  publication isolation pass without exceptions. Zero relevant P0/P1 defects
  remain open; approved noncritical exceptions are explicit and linked.
- Public hostname routing, Page/Post delivery, navigation, responsive layouts
  and keyboard controls are verified through actual browser requests.
- Backend/frontend/typecheck/build/E2E and OpenAPI checks pass on the same
  reviewed revision; remote CI run URLs and reports are attached or linked.
- Evidence contains no passwords, live tokens or cookies. Dedicated QA accounts,
  temporary grants and configuration changes are safely cleaned up/restored.
- QA Lead, Technical Lead and Product Owner record their actual signed
  GO / CONDITIONAL GO / NO-GO decisions. No signature or approval is synthesized.
- Attach/link the final report, defect resolutions, CI results and security
  evidence to P2-QA-GATE-001 before closing it or approving Sprint 3 readiness.

**Required evidence:** final 38-case report/CSV, screenshots and redacted HTTP
records, fresh/existing deployment logs, test/schema/CI reports, cleanup record,
approved exceptions if any, and genuine stakeholder decisions.

## Shared definition of done

Each remediation story requires reviewed code/configuration or a reviewed
documented decision, automated tests appropriate to its change, current
API/schema/migration references where applicable, preserved Site boundaries,
and linked implementation/CI evidence. Re-run the affected real acceptance
cases before resolving the corresponding defect. Closing a story alone does
not approve the release gate or imply a commit/PR/CI result that does not exist.
