# Central module management fixes — 2026-11-10

The audited production gate, preview/apply validation mismatch and Site scope
ceiling are fixed. Browser lifecycle coverage and bounded Admin test concurrency
were added. Production sign-off still requires resolution of the separate full
backend regression failures listed below.

## Changes

- Central module operations require the existing platform permission in every
  environment, without requiring DEBUG or the legacy development write opt-in.
  Other administration APIs retain their policy. Production-mode tests verify
  both authorized execution and denied Site Administrator requests.
- Python and PostgreSQL allow an existing assignment to be disabled with its
  unchanged retained settings after schema evolution. Activation, settings edits,
  lifecycle and dependency checks remain enforced. Migration
  `sites.0010_retained_module_deactivation` was applied on the local stack.
- Scope resolution and request validation no longer cap matching/selected Sites
  at 1,000. Signed selected-Site tokens no longer have an 8 KB field ceiling.
  Operations remain synchronous and atomic. Deployment capacity and request-body
  limits still apply. Tests cover ALL, ORGANIZATION, FILTER and SELECTED scopes
  with more than 1,000 matching Sites and a change beyond the former limit.
- Admin Vitest uses two workers to avoid starving asynchronous UI assertions.
- A reusable localhost fixture/browser runner checks the full writable journey.
  Updated OpenAPI contracts match the generated schema; unrelated existing
  schema drift was not included in this patch.

## Verification

| Check | Result |
| --- | --- |
| Focused backend module suites | 41 passed |
| Admin Vitest | 387 passed across 51 files |
| Shared UI Vitest, including public rendering | 89 passed across 12 files |
| Admin and public TypeScript checks | Passed |
| Writable browser lifecycle | 8 checks passed |
| OpenAPI generation/validation and changed-contract comparison | Passed |
| Migration application and model migration drift check | Passed; no model drift |
| Full backend regression | 680 passed, 7 failed, 2 skipped |

The browser run enabled POSTS for synthetic Informatics and Medicine Sites,
verified both authorized workspaces and an unselected disabled Site, created and
submitted a Post, approved and published it with distinct users, checked public
API and rendered delivery, disabled POSTS, verified denied delivery and hidden
navigation, restored the retained publication, inspected audit before/after
states and actor, and verified Site Administrator central-access denial.
See [browser results](browser-results.json), [operation history](operation-history.png)
and [focused backend results](backend-focused.xml).

Initial harness runs identified selector/fixture errors: the Apply button label,
the SiteSection disabled message, missing workspace viewer grants for workflow
actors, and the local ingress's `.uog.local` allowlist. These were corrected;
the final eight-check result is a new complete run, not a relabeled failure.
The in-app browser tool could not start because of a sandbox metadata error;
the repository's standalone Edge/Playwright workflow was used instead.

## Remaining regression failures

See [machine-readable results](backend-regression-results.json).

- Five tests expect shipped content modules to be globally disabled. Existing
  `api.0006_enable_shipped_content_modules` explicitly enables PAGES, POSTS and
  MENUS. These failures concern registry defaults and migration expectations.
- The documentation test expects a route set without the existing Site role,
  user directory and user search endpoints.
- The domain-boundary test rejects the existing demo seeder's direct import of
  Organizations models from the Sites management command.

The migration, endpoints and demo seeder responsible for these mismatches were
not changed by this patch. These failures remain unresolved; the full regression
suite is not green.

## Local QA data and cleanup

All temporary QA accounts are disabled, grants revoked, and all 15 synthetic
Sites from harness development/reruns archived. No active QA user or private
session file remains. Content and operation/audit history are retained. The
initially empty local organization table received a synthetic QA university
root; it remains because root and history integrity prevent routine deletion.
The reusable fixture driver now requires an existing active organization and
does not create roots. Global module availability, existing non-QA assignments
and developer volumes were not altered by the harness.
