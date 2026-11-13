# Post metadata QA

The implementation reuses Site-owned Posts, Categories, Tags, revisions and publication snapshots. The settings workflow supports the Main Site and eligible child Sites through the same API and editor.

| Criterion | Automated evidence |
| --- | --- |
| AC-01 | API complete metadata create/read and Main/child Site cases, browser save/reopen and taxonomy-only edit |
| AC-02 | Duplicate Site slug API validation and browser field correction/retry |
| AC-03 | Same slug accepted on two independently hosted Sites in the real API rehearsal |
| AC-04 | Reserved, malformed and oversized slug tests preserve the previous values and revision |
| AC-05 | Both foreign and inactive categories/tags are rejected, real UI excludes foreign and inactive choices |
| AC-06 | Scoped-role API tests and real authenticated viewer update rejection |
| AC-07 | Direct metadata update rejected after POSTS disable, followed by successful re-enable |
| AC-08 | Published metadata locks, immutable snapshot preservation across unpublish/restore/edit/republish and anonymous draft exclusion |

[Backend and CMS regression results](backend-tests.xml), [component results](component-tests.xml), [real API results](live-api.json), [browser workflow](browser-results.json), [accessibility scan](accessibility.json), [admin build](admin-build.log), [public build](public-build.log), [TypeScript](typecheck.log) and [validation summary](validation.json) record the results. Screenshots cover [identity settings](settings-identity.png), [taxonomy settings](settings-taxonomy.png), [mobile settings](settings-mobile.png) and [public metadata](public-metadata-mobile.png).

The real API and browser checks use Keycloak, Django, PostgreSQL, Nginx and Next.js. The catalog fixture includes 101 eligible categories to exercise the second taxonomy page, plus inactive and foreign terms. Hostnames identify two separate Sites. Actor credentials are supplied on stdin and retained only in a mode-0600 container temporary file until generated identities are disabled. [Cleanup](cleanup.json) records that result.

The Post serializer previously set many-to-many values after the revisioned model save. Taxonomy-only changes could retain an old ETag and omit the selected IDs from the revision. Post API writes now pass related values through the existing revision transaction. Complete snapshots include those values, taxonomy-only edits advance the revision and restore recovers Post-specific fields and relations. A failure after writing one relation rolls back the Post, relations and revision together.

The editor now supports removing unavailable taxonomy selections and fetching choices beyond the first 100 rows. Duplicate-slug errors clear when the input changes, enabling correction and retry. The Site membership role helper and its runtime constant moved into a plain shared module because the Server Actions module requires async runtime exports.

Post revision history and restore enforce the POSTS gate. Restoring identical content creates a new revision with its restore origin. The final clean-database suite passed 66 backend tests. The targeted frontend suite passed 20 tests, the real API rehearsal passed 27 checks and the Edge workflow passed nine checks with zero automated accessibility violations.

The metadata feature uses existing columns and constraints. `makemigrations --check --dry-run` reports no changes. The clean-database regression applies the migration graph, including the existing no-operation Sites merge from the preceding Post editor work. [Post editor migration rehearsal](../post-editor-2026-11-13/migration-rehearsal.txt) records that merge's apply, reverse and reapply. The schema guard is defined in `backend/apps/api/taxonomy_sql.py` and migration `api.0005_post_taxonomy_sitecontent`.

Published Post edits follow the existing unpublish/restore workflow. During draft editing the article is withdrawn from public delivery. Its prior immutable publication metadata is retained until the next publication creates another snapshot. Continuous public visibility while editing would require the Post working-draft extension raised in the pending policy question.

Independent code review, PR/merge and Azure DevOps Issue attachment require the repository review and Issue identifier. The API contract and user guidance are prepared. [API guide](../../post-metadata.md) and [OpenAPI](../../api/openapi.yaml)

The later article workflow implementation adds working copies for published Posts. Its API, migration and browser evidence cover continued public visibility during review. [Workflow QA](../post-workflow-2026-11-13/README.md)
