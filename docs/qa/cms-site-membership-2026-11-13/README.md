# CMS Site membership permission fix

Reference `8c21ee3e-bfae-48cb-869f-b77d6e43d586` resolved to a `CMS_AUTHORIZE` denial on Site 16. The account had a live database-backed Site Publisher assignment, but the central CMS authorization function recognized only the separate legacy SiteContentRoleAssignment table. Site Users onboarding and assignment therefore did not authorize the CMS screens they advertised.

The central gate now evaluates live standard Site memberships directly, without copying grants into a second table:

| Site membership | CMS access |
| --- | --- |
| Site Administrator | Author, review and publication operations |
| Editor | Author operations |
| Reviewer | Review operations |
| Publisher | Publication operations |
| Viewer | Read-only operations |

All five roles can use the existing CMS read contract on their own Site. Revocation, expiration and role deactivation take effect immediately. Foreign-Site memberships and realm role claims grant no access. Existing explicit legacy CMS grants remain compatible. Module gates, state transitions, reviewed-revision checks and separation-of-duty rules remain enforced by their existing services.

[Regression results](backend-tests.xml) include all membership roles reading Pages/Posts without legacy CMS bindings, mutation restrictions, foreign-Site denial, revoked/expired/deactivated grants, and an Editor → Reviewer → Publisher → unpublish handoff using membership assignments alone. Existing realm-role isolation and public Post tests also pass: **17 tests, zero failures/errors**. Django system check passes.

The affected live account was tested through the actual DRF list views with its persisted database identity (internal authenticated request factory, without using its password). Both Site 16 Posts and Pages returned HTTP 200. Its central permission checks allowed read/publication and rejected authoring. This is backend authorization evidence; a new interactive browser login was not performed for that account.

No data migration, role duplication, frontend change or frontend rebuild is required. The local backend hot-reloaded the fix. Deployments running a packaged backend need the updated backend release/restart. Refresh the failed page to clear its error boundary. Independent review and PR/Issue association remain pending.
