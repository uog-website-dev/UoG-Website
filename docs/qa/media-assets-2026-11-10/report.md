# Site-owned media asset verification — 2026-11-10

The backend asset foundation is implemented and the three additive media
migrations are applied on the local development database. No object uploads,
object deletions or global/Site MEDIA activation switches were performed.
The normal RBAC seed was reconciled without creating user assignments.
ADR-006 was waived by the user.

## Evidence

| Requirement / check | Evidence and result |
| --- | --- |
| Clean database migrations | Full pytest invocation creates a new PostgreSQL test database and applies the migration graph; no reused test database was requested. [Full JUnit](backend-full.xml): 697 passed, 2 skipped. |
| Upgrade from the pre-media Sprint 2 graph | `test_upgrade_from_pre_media_sprint_two_preserves_page_and_revision` rolls media back to zero, creates an existing Page/revision including a legacy image string, reapplies the latest graph, and verifies exact retained content/snapshot. Passed in [final focused JUnit](media-and-revisions.xml). |
| Canonical storage object identity | Duplicate registration produces PostgreSQL SQLSTATE 23505; only one asset and audit transition remain. Concurrent registration has one winner. [Test details](verification.json). |
| All-path ownership protection | QuerySet and raw SQL attempts to alter Site, storage reference, checksum or creator fail. Service/API ownership changes fail too. [Tests](../../../backend/tests/test_media_assets.py). |
| Two-Site selectors | `test_two_site_selectors_updates_and_reassignment_never_expose_foreign_metadata` verifies empty scoped results, foreign-ID 404, foreign-Site permission denial, rejected reassignment and unchanged foreign metadata/audit history. Passed. |
| Placement granularity and reuse | Slider/Gallery/repeater references share one asset; duplicate slots and foreign assets/revisions are rejected. Removing one entry leaves other uses resolvable. Archive/restore retains those references. Passed. |
| Usable API revision identity | Scoped revision APIs expose the revision ID; the authenticated HTTP attachment/list/detach test obtains that ID through the API. Passed. |
| Lifecycle/audit | Legal transitions, terminal rejection, archived-Site freeze, actor/Site audit metadata and audit-failure rollback pass. |
| Final focused run | 19 passed: 16 media cases plus 3 existing revision API cases. [JUnit](media-and-revisions.xml), [machine-readable results](verification.json). |
| Existing Admin regression | 387 passed using `pnpm --filter @uog/admin-web exec vitest run --maxWorkers=2`. |
| Public/shared rendering regression | 89 passed using `pnpm --filter @uog/ui exec vitest run --maxWorkers=2`. |
| TypeScript | Admin and public-web typechecks passed. |
| OpenAPI | Generation/validation with `--fail-on-warn` passed; checked-in schema regenerated. |
| Model/migration consistency | `makemigrations --check --dry-run`: no changes detected. |

The full backend run preceded the final extra image-inspection test and the
additive revision-ID response field. The final focused run covers both changes,
the strengthened foreign-revision/duplicate-slot checks, and the legacy-image
migration rehearsal. The two full-suite skips are existing documentation checks
whose Markdown files are not mounted in the runtime container.

Initial unrestricted frontend worker runs failed under parallel resource
contention (Admin: 10 timeouts/assertion failures; shared UI: one timeout). The
complete suites passed with two workers, without frontend source changes.

## Schema and rollout

[Schema constraints and indexes](schema-constraints.json) were read from the
local PostgreSQL schema after applying migrations. They include the unique
storage reference, Site and creator foreign keys, status/MIME/checksum/dimension
checks, unique placement slot and `media_site_status_idx` on
`(site_id, status, created_at DESC)`. Triggers additionally reject immutable
field edits, unguarded writes and cross-Site references and persist audit events.

Implementation:
[models](../../../backend/apps/media/models.py),
[integrity migration](../../../backend/apps/media/migrations/0002_integrity.py),
[selectors](../../../backend/apps/media/selectors.py),
[services](../../../backend/apps/media/services.py),
[API](../../../backend/apps/media/api.py).
See the [asset identity/reference contract](../../architecture/media-assets.md)
for legal states, reference granularity and compatibility decisions.

The MEDIA registry entry is shipped but its platform availability is unchanged
(disabled on a clean database). Enable it globally and for the intended Site
through the existing module controls before using the endpoints. Registration
catalogs an already stored object; this story does not provide an upload UI,
antivirus pipeline or public file-delivery policy.

The advanced Slider/Gallery builder is absent from this checkout. Its browser
regression cannot be claimed. Backend reference reuse and the existing Page,
Post, revision and public rendering regressions are verified; wiring a future
builder to these APIs remains an integration task.
