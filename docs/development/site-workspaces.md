# Platform and Site administration workspaces

The same `/admin` application, theme, header, sidebar, form controls and feedback
components serve Platform Administration and Site Administration.

The Workspace selector offers Platform Administration only when the current
account has effective **platform-scoped** permissions. Site choices come from
Django's authorized Site inventory. Selecting a Site opens
`/admin/sites/{id}/admin`; Pages, Posts and Menus keep that ID in their routes.
Switching Sites opens the new dashboard and remounts Site forms.

The active Site card shows its name, status, code and owning organization. When
the account cannot read the organization name, it displays the organization
unit ID already authorized in the Site response. This card stays visible while
the content scrolls. Mobile/tablet navigation uses the same menu in an
Enter/Escape-operable drawer. Long account names cannot hide Sign out.

## Permissions and module availability

`/admin/api/workspace/` returns private, noncached workspace information. It
queries scoped backend permissions and the authorized Site list; it does not
interpret Keycloak realm roles as management grants. Invalid, repeated and
unsafe-integer Site selections are rejected. A foreign Site selection returns
no current Site and does not query that Site's module/permission details.

Site sections require an effective permission and an enabled module. The
SiteModule API's read-only `is_available` field reflects the existing backend
selector: the Site switch is on, the registry switch is on, the module is
implemented, and its capability is shipped. `is_enabled` remains the local
switch and is not overwritten by a global disable. Availability serialization
uses one shared query per Site inventory, rather than a query for each row.

This UI filtering does not grant access. Django continues to authorize every
Site resource request and every content/workflow operation. No staff flag,
superuser flag, hard-coded identity or temporary public write bypass is used.

## Dashboard and feedback

The dashboard reads Page status counts, Post counts and local Menu/item trees
through the Site-scoped server actions. It does not use example counts.
Disabled/unavailable sections are omitted without calling their content APIs.
Create page opens the current Site's draft form; Manage navigation opens that
Site's menu section. Loading, empty, disabled and retriable API-error states
remain distinct. A failed workspace inventory is not labeled as no assignment.

## Verification

Run Admin Vitest, the frontend workspace typechecks and production builds.
Backend regression includes effective module availability, immutable response
fields, bounded queries, scoped permissions and existing CMS workflows.

The local real-service QA uses `scripts/qa-workspace.py` with `setup`, `finish`
and `cleanup`, plus `scripts/qa-workspace-browser.cjs`. Credentials are passed
on stdin from the local Compose configuration and kept only in a mode-0600
temporary session file until cleanup. Setup uses dedicated Keycloak identities,
protected assignment APIs and the retained synthetic QA Sites, not institutional
production data. Do not print the resolved Compose configuration or private
session file, or capture OAuth URLs, tokens or cookies in evidence.

Execution evidence: [4 November workspace QA](../qa/site-workspace-2026-11-04/report.md).
Remote CI and reviewer approval are separate from these local results.
