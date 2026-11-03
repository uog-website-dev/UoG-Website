# Defect register — 2026-11-02

Build: `cd704d3f8743dafd65f91ced302a704033977c9a` (`P2-FE-010`).
All references below are local defect references ready for Azure DevOps entry,
not fabricated remote issue links. QA-SEC001's realm-role CMS bypass was
corrected locally on 3 Nov 2026 and is awaiting a signed commit and a fresh
gate run. QA-D001's module transaction error was corrected locally on 3 Nov
2026 and is awaiting the same signed commit and fresh gate run. QA-D002's
effective-permission route was corrected locally on 3 Nov 2026 and is
awaiting that same signed commit and fresh gate run. QA-D004's access
screen was corrected locally on 3 Nov 2026 and is awaiting that same
signed commit and fresh gate run. QA-D003's logout allowlist was
reconciled locally on 3 Nov 2026 and is awaiting that same signed commit
and fresh gate run. QA-D005's regression and typecheck failures
were corrected locally on 3 Nov 2026. The fresh suite counts below
replace the earlier failure counts. QA-GAP001's published-page working
draft was demonstrated locally on 3 Nov 2026. A pull request carries the
revision CI must run. The other findings remain open. Priority P1 means
a high-priority release blocker in this assessment; institutional triage may
raise it. No exception is approved.

## QA-SEC001 — P1 / High — realm claim bypasses Site authorization

**Cases:** T15, T16, T17, T35. **Automatic NO-GO.**

The approved [RBAC decision snapshot](evidence/rbac-decision.md) says Keycloak claims
authenticate identity only. Database application assignments govern resources.

Reproduction on real Keycloak/Django/PostgreSQL:

1. Dedicated QA Viewer has only Site 6 Viewer/Reviewer database assignments,
   no platform-administrator assignment, no Site 7 assignment, and no Site 7
   CMS role. The exact principal and bindings are recorded under
   `state.security_probe` in [live-results.json](evidence/live-results.json).
2. Without an elevated claim, ordinary Site A actors requesting Site B Pages
   are rejected with 403 (control request recorded).
3. Give that same dedicated identity only the Keycloak `platform-admin` realm
   role; obtain a new genuine signed access token. No database grant is added.
4. `GET /api/v1/sites/7/pages/` returns **200**.
5. `POST /api/v1/sites/7/pages/` with a new QA-only title/slug returns **201**.

Expected: 403/404, with no foreign Page created. Actual: foreign administration
read and write permitted. This does **not** claim that arbitrary unauthenticated
users can forge Keycloak tokens; it proves that an identity-provider claim
overrides the approved application permission boundary.

Source: `backend/apps/cms/api/pages.py` `_roles`/`_authorize` accepted the token
role alongside the database check. The same claim shortcut was present on Post
authoring, workflow actions, workflow history, revision reads, and revision
restore. Menu administration already used `permission_granted` and denied a
realm-role-only caller.

**Corrected 3 Nov 2026.** CMS page, post, workflow, and revision operations now
authorize only an active database `platform-administrator` assignment or a
live Site CMS role on the resource's Site. Realm roles, staff, and superuser
flags do not grant those operations. A real Keycloak user whose token carried
`platform-admin`, with a Site A viewer assignment and no platform or Site B
grant, received 403 for Site B page list and create. No page was inserted.
Two `CMS_AUTHORIZE` / `DENY` audit rows were recorded for Site B. The Keycloak
user was deleted and the local account deactivated. Signed-token pytest covers
the same disagreement for pages, posts, workflow, revisions, expired and
revoked platform grants, and author/reviewer separation.

Evidence: [redacted live HTTP result](evidence/sec001-http.json). The original
[HTTP transcript](evidence/http-transcript.json) remains the before case. No
pull request or remote CI run is attached; the correction is local until a
signed commit is requested.

Original evidence: [HTTP transcript](evidence/http-transcript.json),
[principal/binding proof and actual results](evidence/live-results.json).
The temporary realm role was removed immediately; dedicated identities were
disabled, sessions logged out, DB grants revoked and CMS bindings removed later.

## QA-D001 — P1 — module administration raises transaction errors

**Cases:** T10, T11, T38.

As a real DB-granted platform administrator, obtain the resource ETag and call:

- `PATCH /api/v1/modules/11/` with `{"is_enabled":true}`;
- `POST /api/v1/sites/6/modules/11/disable/` with `{}`;
- the corresponding `enable/` action.

Expected: a transactional authorized update, or a documented validation/conflict
response. Actual at the gate: **500**, `TransactionManagementError: select_for_update cannot
be used outside of a transaction`.

Source: `backend/apps/sites/api/access.py` `AdministrationViewSet.lock` takes a
row lock; callers in `backend/apps/sites/api/views.py` Module/SiteModule actions
did not open a transaction. Ordinary pytest DB wrappers conceal this real
HTTP/autocommit defect.

**Corrected 3 Nov 2026.** Global module PATCH, Site module create, settings
PATCH, enable, and disable, and Site template PATCH now take the row lock,
compare `If-Match`, validate, and save inside `registry_write`
(`transaction.atomic` plus the database audit context). The row lock stays.
A planned or unshipped module still cannot be implemented or globally enabled.
Disabling one Site keeps that row and its configuration and does not change
another Site. Page inspection stays available while page, post, and menu
mutations and public delivery stop. Turning the module back on restores
delivery. A stale `If-Match` returns 412 and leaves the committed row. Two
concurrent updates with the same ETag produce one 200 and one 412. An audit
context failure after the write rolls the name change back.

The new tests use `django_db(transaction=True)` and assert PostgreSQL
autocommit is on, so the surrounding pytest transaction cannot hide the
original `select_for_update` error. The live development server still has
organization writes closed, so this was not repeated against the running
site database. No pull request or remote CI run is attached; the correction
is local until a signed commit is requested.

The gate workaround that flipped fixture switches is no longer required for
this defect. The cases stay FAIL until the fresh gate run. Content
enforcement from that run remains: public POSTS returned 404 with content
retained; public MENUS UI disappeared while off.

Evidence: [HTTP transcript](evidence/http-transcript.json),
[live results](evidence/live-results.json),
[public module gate](evidence/browser-module-results.json),
[autocommit HTTP tests](evidence/module-transactions.log).

## QA-D002 — P1 — effective-permission inspection returns 500

**Cases:** T15; related access-management investigation T13.

Request `/api/v1/authorization/assignments/users/{qa_user_id}/effective/?scope=SITE&site=6`
as the authorized platform administrator. The Editor, Reviewer and Viewer
requests each return **500**, `NameError: name 'get_object_or_404' is not defined`.

Expected: registered effective permissions for the validated requested scope,
with ordinary authorization/validation failures handled predictably.

Source: `backend/apps/authorization/views.py`, `AssignmentViewSet.effective`.
The route called `get_object_or_404` without importing it. A supplied Site id
also replaced the organization instead of checking ownership.

**Corrected 3 Nov 2026.** The assignment route now resolves an active user and
a PLATFORM, ORGANIZATION, or SITE scope. Site ownership comes from the Site
row. A supplied organization that does not own the Site returns 400. Unknown
users, sites, and organizations return 404. Malformed identifiers return 400
without a NameError or SQL text. Editor, Reviewer, and Viewer responses match
their registered capability sets. Expired, revoked, inactive-role, and
inactive-permission grants are omitted. A platform administrator receives only
the approved platform capability set. A realm `platform-admin` claim without
a database grant is 403, and a Site Viewer cannot read another Site. Denied
responses do not include the target permission list. The self-service
`/me/permissions/` route was not used as a substitute.

No pull request or remote CI run is attached; the correction is local until
a signed commit is requested. T15 stays FAIL until the fresh gate run because
the original SEC001 finding was also attached to that case.

Evidence: [HTTP transcript](evidence/http-transcript.json),
[live results](evidence/live-results.json),
[route tests](evidence/effective-permissions.log),
OpenAPI `GET /api/v1/authorization/assignments/users/{user_id}/effective/`.

## QA-D003 — P1 — existing Keycloak logout configuration rejects return URI

**Case:** T12. **Corrected locally on 3 Nov 2026. Awaiting a signed commit and a fresh gate run.**

Actual browser authorization-code login succeeded and produced HTTP-only
Auth.js session cookies. Clicking **Sign out** reached Keycloak's
**Invalid redirect uri** page instead of returning to the signed-out console.
The stored `admin-web` attribute was one literal value joined with `+`:

```text
http://localhost:3001/admin/*+http://localhost/admin/*
```

Keycloak 26 splits `post.logout.redirect.uris` on `##`. The repository realm
file already uses that separator, and a fresh import keeps it. Keycloak does
not re-import a realm that already exists, so `keycloak-init` now rewrites
the approved `admin-web` and `public-web` entries on an existing realm when
they differ, and leaves them alone when they already match. It does not
create clients or users and does not log the client body. The allowlist is
the same two patterns per client as the realm file. A bare `*` was not added.
`backend-api` stays at the single `+` token because that client has no login
redirects; it was not opened up.

Recheck on 3 Nov 2026: the first init run replaced both drifted attributes,
the second run reported they already matched, and the user count stayed 13
with one client of each id. An unapproved logout URI and an unapproved login
redirect returned 400 and no `Location`. `http://localhost/admin/` is accepted
only as a logout return. In the browser, Sign out landed on
`http://localhost/admin/` with **Sign in required**, `/admin/access` stayed
behind that prompt, and the next sign-in showed the Keycloak form before a
new authorization-code session. A missing ID token still clears the local
session and sends `client_id` instead of `id_token_hint`. T12 stays open for
the unrepeated 300-second expiry check. No pull request or remote CI run is
attached.

Evidence: [reconciliation log](evidence/logout-reconciliation.log),
[signed-out console](evidence/logout-signed-out-home.png),
[protected page after sign-out](evidence/logout-protected-access.png),
[Keycloak form on re-login](evidence/logout-relogin-form.png),
original [logout failure screenshot](evidence/T12-logout-failure.png).

## QA-D004 — P1 — authenticated access-management UI omits real grants

**Case:** T13. **Corrected locally on 3 Nov 2026. Awaiting a signed commit and a fresh gate run.**

The mounted access page treated a failed or unreadable authorization response
as an empty grant list, and a signed-in session without a usable access token
stayed on that empty copy. Loads now keep each catalog separate: a section is
empty only after a successful empty payload, and a backend or authentication
failure shows the envelope message, any `detail`, and the correlation id.
The access token stays in the server session.

A fresh Keycloak session for the database platform administrator then showed
the registered permission catalog and the Editor, Reviewer, and Viewer
permission arrays. Assigning Editor to user 16 on organization 5, site 1
returned those Editor codes and an active Site row. Revoking that row left it
Revoked and the user's site effective list empty. Assigning a role to user 1,
the signed-in administrator, was rejected with "You cannot assign a role to
yourself" and reference `d925b716-0bf1-4952-846c-712d9303cb42`. A
platform-administrator session can assign on every Site, so a foreign-site
denial was not available in that browser session; the same error panel is
covered by the access-control component test.

No pull request or Azure pipeline result is linked. T13 stays FAIL until a
fresh gate. The earlier empty-screen artifacts remain the reproduction record.

Evidence: [self-assignment denial](evidence/access-self-denied.png),
[assigned Editor permissions](evidence/access-assigned.png),
[revoked Site assignment](evidence/access-revoked.png),
[browser notes](evidence/access-management.log),
[original empty screen](evidence/admin-access.png).

## QA-D005 — P1 — regression/typecheck gates are not green

**Case:** T37. **Local suites replaced on 3 Nov 2026. The pull request CI run is the remote record.**

The earlier counts stay as history: backend 627 passed with 2 documentation
skips; Admin 257 passed, 32 failed, 12 unhandled errors; typecheck exit 2
with 13 Admin diagnostics. Those are not the current result.

Fresh run on 3 Nov 2026, same working tree:

- Backend **643 passed, 0 failed, 0 errors, 0 skipped**. The docs tree was
  copied to the path the contract tests read, so
  `test_documented_block_contract_matches_the_domain` and
  `test_documented_strategy_matches_the_migration` executed. The skip remains
  only when those files are absent from a code-only image. It was not used
  on this run, and no security test was skipped or removed.
  `test_cms_mounts_scoped_workflow_revision_admin_and_public_routes` passed.
  `content-workflow-history` is still a registered route.
- Admin frontend **304 passed, 0 failed**. A missing or non-array inheritance
  list is no policy. A malformed entry is ignored. A failed menu load stays
  an error. The 20 second test budget covers the Site editor dialogs; the
  assertions are unchanged.
- Shared UI **86 passed**. API client **157 passed**. Both were forced, not
  replayed from cache.
- Typecheck: 5 packages successful, including Admin.
- Production `pnpm build` ran from `/tmp/uog-frontend-build`, which was copied
  without any development `.next` directory. Admin and public builds both
  wrote a new `.next` there. Exit 0.
- Browser, signed in through nginx: Informatics Site rendered its real local
  Header and Footer and the empty inheritance policy. The page did not crash.

The recorded type errors are fixed in code: access actions are exported, the
footer receives `apiBaseUrl`, the Post list query uses its own type, and
private previews supply `site` and `seo`.

Evidence: [fresh JUnit](evidence/backend-junit-2026-11-03.xml),
[suite notes](evidence/regression-suite.md),
[Informatics navigation](evidence/regression-site-navigation.png).
The earlier [backend JUnit](evidence/backend.junit.xml) and
[typecheck log](evidence/frontend-typecheck.log) remain the historical record.

## QA-GAP001 — P2 / acceptance gap — draft/public coexistence demonstrated locally

**Case:** T23. Corrected locally on 3 Nov 2026. The earlier blocked result
remains the historical observation.

The first attempt patched a published Page directly. That returned **400**
and the public snapshot did not change. That rejection stays in place.

The approved contract is a working draft: an AUTHOR opens one DRAFT Page
linked to the published Page, edits that draft, and a different reviewer and
publisher release it through the existing workflow. On the running stack,
`www.uog.local` kept serving `T23 visitors` at publication version 1 while
the draft title was `T23 visitors revised`. A direct PATCH of the published
Page returned 400. The author received 403 on approve. After independent
approval and publication, the same public route served `T23 visitors revised`
at publication version 2 and the draft was archived. Unpublish then returned
404 for that route. The temporary reviewer and publisher assignments were
revoked and those Keycloak accounts were disabled. The probe Page remains
unpublished on Main Site.

Evidence: [T23 sequence](evidence/t23-working-draft.md),
[editor screenshot](evidence/t23-working-draft.png).
The earlier [blocked observation](evidence/live-results.json) is unchanged
history.

## Follow-up execution order

1. Fix SEC001 and add signed-token/DB-scope disagreement regressions.
2. Fix transactional module management and effective-permission route errors.
3. Reconcile logout configuration; repair access UI and regression/typecheck gates.
4. Execute T23 with the approved draft workflow and run T38 in an isolated fresh
   stack. Preserve the current development data rather than wiping its volumes.
5. Re-run all 38 cases without fixture workarounds, link remote CI and defect
   resolutions, then obtain actual QA Lead/Technical Lead/Product Owner decisions.
