# Workspace administration implementation and QA

Executed **4 November 2026**, using the working tree based on
`e42a429d15891ded6710bb7d5739092ae7bdb76c`. Tester: Codex automated tests,
real HTTP/Keycloak flows, headless Edge and visual inspection.

**Outcome: locally verified and ready for review.** This does not approve
Sprint 3, replace the integrated acceptance gate, or constitute a reviewer or
stakeholder signature. Remote CI for these uncommitted changes remains pending.
No commit or push was performed by this agent.

The existing workspace implementation and other user edits were preserved.
The remaining gaps were fixed: effective global/Site module availability,
ambiguous workspace selection validation, workspace read-error messaging,
Site identity visibility during scrolling, and mobile access to Sign out.

## Acceptance evidence

| Requirement | Result | Evidence |
| --- | --- | --- |
| Shared Platform/Site design system | PASS | Same AdminShell, UogHeader, sidebar and MUI theme; `platform-dashboard.png`, `site-dashboard-desktop.png`. |
| Hide unauthorized Platform navigation | PASS | Real Site-only account had no Platform links or Platform selector option. `browser-functional-results.json`. |
| Authorized workspace switching | PASS | Site-only selector offered only Site 12; forged Site 13 returned no current workspace. Platform account switched between Platform and Site 13. |
| Active Site name/status/organization stay visible | PASS | Sticky Site context retained name/status/code and organization unit ID during scrolling at all three viewport sizes. Organization names are displayed only when separately readable. |
| Permission and module-adapted sections | PASS | Globally disabled Posts remained locally enabled but `is_available=false`; Posts navigation/summary were hidden. Backend read-only availability, scoped queries and permission/module regression tests passed. |
| API-driven dashboard summaries | PASS | Page and Menu metrics matched protected backend responses. Page draft count increased after browser creation. Enabled Post count queries are covered by dashboard unit tests; this live QA Site had Posts globally disabled. |
| Quick actions and Site context | PASS | Create page opened Site 12's form and saved a draft; navigation returned to the same dashboard and menu workspace. |
| Desktop/tablet/mobile and keyboard controls | PASS | 1440×1000, 768×1024 and 390×844; Enter opened navigation, native workspace control loaded the correct Site, Escape closed the drawer, Site context stayed visible, Sign out stayed within the viewport, no document overflow. `browser-responsive-results.json`. |
| Existing CMS workflows | PASS | Browser-created Page submitted, approved and published through protected APIs by separate authorized accounts; public delivery returned it under its owning hostname. `live-results.json`, `http-transcript.json`. |
| Automated tests/typechecks and isolation | PASS | 652 backend tests; 599 frontend tests (355 Admin, 158 API client, 86 UI); five typecheck tasks; both production builds. Final header/layout changes also passed 13 targeted tests, Admin typecheck and a fresh Admin production build. Foreign Site content returned 403 through Django. |

## Backend/API change

SiteModule responses add read-only `is_available`, calculated using the existing
shared backend availability selector. It accounts for the local switch, global
switch, implementation status and shipped capability. `is_enabled` retains its
local management meaning. A paginated Site inventory uses one shared
availability query, verified by the bounded-query test; a global disable does
not erase local assignments. Attempts to write `is_available` return validation
errors. No model or migration was added.

OpenAPI was regenerated and validated without warnings. The workspace API uses
scoped Django permissions and authorized Site records; raw realm roles are not
treated as management authority. Backend enforcement was not weakened.

## Browser execution record

`browser-initial-results.json` and `initial/` preserve the first run. It saw an
older running admin bundle and used an outdated editor button label; subsequent
steps were affected by the still-open create dialog. After refreshing the dev
process and correcting the driver label, the functional cases passed in
`browser-functional-results.json`.

That functional run's responsive checks initially inspected the mobile selector
before its async workspace load completed. The driver now waits for the
authorized option. Visual inspection also caught field labels overlapping the
sticky Site card and a long email clipping Sign out; these were fixed. The
final controlled responsive run passes all three sizes and checks Sign out's
actual viewport bounds. Earlier failures were retained, not relabeled.

The consolidated [browser checklist](browser-checklist.csv) selects the latest
controlled result for each of the 11 browser cases and names its source file.
Screenshots are unmodified browser captures. This is targeted responsive and
keyboard QA, not a full accessibility certification.

## Cleanup and review

Dedicated run: `qaws7bf27e71`, using retained synthetic QA Sites 12 and 13.
Four Keycloak accounts were disabled and their sessions terminated; four
temporary grants and three CMS role bindings were revoked, and the private
session file was removed. A partial initial setup account was also disabled
(`setup-attempt-cleanup.json`). Module switches, developer volumes and production
permissions were not changed. The published synthetic QA Page and audit history
remain in the QA Site for inspection. `cleanup.json` records the cleanup.

Credentials traveled only through stdin and a temporary mode-0600 private
session file. No tokens, passwords or cookie values were captured in the HTTP
records or screenshots. `secret-scan.json` records the text scan; code hashes
identify the reviewed working-tree snapshot.

Remaining: human implementation review and remote CI/issue attachment. No
Azure DevOps issue target was supplied for this workspace story; the report and
evidence package are available locally for attachment. The earlier integrated
gate's sign-off/remote E2E requirements have not been declared complete here.

Developer guide: [Site workspaces](../../development/site-workspaces.md).
