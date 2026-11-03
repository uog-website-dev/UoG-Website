# Shared CMS review and publishing workflow (P2-CMS-004)

Pages and future Posts share one status machine on `SiteContent`. Status
changes go through `apps.cms.services.workflow.transition_content`; direct
model status changes are rejected, and PostgreSQL triggers enforce the state
edges, audit each accepted status change, and protect the public payload.
PAGES and POSTS are implemented but globally and per-Site disabled by default.
The workflow administration API is mounted at
`/api/v1/cms/sites/`; Page CRUD and public delivery are documented in the
[Page API contract](../api/cms-pages.md). The authenticated actor is resolved from the Keycloak token. Application
authority comes from an active database platform-administrator assignment or
a Site CMS role on the resource's Site. Realm roles, staff flags, and
client-supplied role names are not authorization sources.

## HTTP integration

| Method and path | Access | Contract |
| --- | --- | --- |
| `GET /api/v1/cms/sites/{site_pk}/content-roles/` | active database platform-administrator assignment | List CMS role assignments for this Site |
| `POST /api/v1/cms/sites/{site_pk}/content-roles/` | active database platform-administrator assignment | Assign an active local user AUTHOR, REVIEWER or PUBLISHER |
| `DELETE /api/v1/cms/sites/{site_pk}/content-roles/{assignment_id}/` | active database platform-administrator assignment | Revoke only an assignment owned by the path Site |
| `POST /api/v1/cms/sites/{site_pk}/content/{content_id}/workflow/` | matching Site CMS role or active database platform-administrator assignment | Apply one workflow action; content is looked up under the path Site |
| `GET /api/v1/cms/sites/{site_pk}/content/{content_id}/revisions/` | any active Site CMS role or active database platform-administrator assignment | List immutable revisions, newest first; returns the current content ETag |
| `GET /api/v1/cms/sites/{site_pk}/content/{content_id}/revisions/{revision_number}/` | any active Site CMS role or active database platform-administrator assignment | Inspect one immutable snapshot and its diff metadata |
| `POST /api/v1/cms/sites/{site_pk}/content/{content_id}/revisions/{revision_number}/restore/` | Site AUTHOR or active database platform-administrator assignment | Restore a prior snapshot as a new DRAFT revision, requiring the current `If-Match` ETag |

The action body accepts only `action` and optional `comment`. The endpoint
derives its role set from validated bearer-token claims and rejects unknown
fields, including attempted `roles` injection. Foreign-Site content and
assignments return 404 rather than exposing their existence. The generated
OpenAPI snapshot documents these routes and their request/response shapes.
Revision history is filtered by both the URL Site and content id. Authors,
reviewers and publishers may inspect history; only an author or platform
administrator may restore. History is paginated (20 rows by default, maximum
100 per page) and ordered by descending revision number. Missing restore ETags
return 428; stale ETags and edits racing a restore return 409.

## State matrix

| Current state | Action | Next state | Required role | Conditions |
| --- | --- | --- | --- | --- |
| DRAFT | `submit` | IN_REVIEW | Site AUTHOR or platform-admin | Submitting user is recorded |
| IN_REVIEW | `approve` | APPROVED | Site REVIEWER or platform-admin | Reviewer cannot be creator or submitter |
| IN_REVIEW | `reject` | DRAFT | Site REVIEWER or platform-admin | Nonblank reviewer comment required; content becomes editable |
| APPROVED | `publish` | PUBLISHED | Site PUBLISHER or platform-admin | Creates an immutable snapshot |
| APPROVED | `archive` | ARCHIVED | Site PUBLISHER or platform-admin | Terminal |
| PUBLISHED | `unpublish` | UNPUBLISHED | Site PUBLISHER or platform-admin | Retains the publication timestamp and snapshot |
| PUBLISHED | `archive` | ARCHIVED | Site PUBLISHER or platform-admin | Terminal |
| UNPUBLISHED | `restore` | DRAFT | Site AUTHOR or platform-admin | Content becomes editable |
| UNPUBLISHED | `archive` | ARCHIVED | Site PUBLISHER or platform-admin | Terminal |
| ARCHIVED | — | — | — | No outgoing transition |

All omitted edges are rejected. A user assigned more than one Site role still
cannot approve or reject content they authored or submitted. An active
database `platform-administrator` assignment covers the workflow roles.
Keycloak realm roles, `is_staff`, and `is_superuser` do not grant workflow
rights. Site-specific roles are represented by unique `(site, user, role)`
assignments in `SiteContentRoleAssignment`. Inactive, expired, and revoked
platform assignments do not authorize.

## Atomicity, audit and repeat requests

Each action locks its `SiteContent` row with `SELECT … FOR UPDATE`, checks the
Site role and current state, updates the state, appends a transition record,
and writes any publication snapshot in one transaction. PostgreSQL status
triggers write an append-only `AuditEvent` in that same transaction; an audit
failure rolls the business change back. The event includes Site id, previous
and next status, actor, and reviewer comment where applicable.

A repeat `publish` on already-published content returns the existing result
without another status transition, audit event or snapshot. Concurrent
publishes serialize on the same row, resulting in exactly one publication
side effect.

## Rejection, editing and publication versions

Rejection records the reviewer, comment and transition, returns the content
to DRAFT, and permits edits. `review_comment` remains visible after rejection
and is cleared on the next submission; the append-only transition history
retains the original feedback.

Content is locked while IN_REVIEW, APPROVED, PUBLISHED or ARCHIVED. Both model
validation and database triggers reject changes to the content payload in
those states. Direct edits of a published Page stay rejected. After
unpublishing, an authorized editor can revise and restore the content to
DRAFT for another review cycle; that path takes the Page off the public
site, so it is not the way to prepare a replacement while visitors still
see the last publication. Use a working draft for that.

Every successful publication writes a `PublishedContentSnapshot` containing
the complete serving payload and a monotonically increasing per-content
version. Snapshots cannot be updated or deleted, and each SiteContent row lock
serializes the version allocation. Existing published records are backfilled
as version 1 by the workflow migration. `published_at` retains the first
publication time; each snapshot has its own publication timestamp.

## Content revisions and restore

Every creation and meaningful save of `SiteContent` or a concrete content
type records an immutable revision in the same database transaction. A
revision includes the editor identity, timestamp, status, complete content
snapshot, sorted changed-field names, and a SHA-256 snapshot hash. Page
snapshots include route and presentation fields. Status transitions,
including publication, create revisions too; the PUBLISHED status revision
and separate serving snapshot are both append-only.

The shared `revision_number` is an optimistic concurrency token. Model saves
lock the content row and compare the token loaded with the instance; stale
instances raise `ContentEditConflict` instead of overwriting newer edits.
Restore additionally requires the current content ETag from the revision-list
response and checks it again under the row lock.

Restore is permitted only while content is DRAFT or UNPUBLISHED. An
unpublished item first transitions to DRAFT through the normal AUTHOR
permission. Reviewed or published items must first move to an editable state
through the workflow. The historical snapshot is never edited; restored
content is saved as a new DRAFT revision and records which revision it came
from. Page route changes use the route-history service, and homepage changes
record history for both pages. Published serving snapshots remain unchanged.

Each snapshot is limited to 1 MiB of serialized UTF-8 JSON. The policy retains
the newest 100 non-published revisions per content item, every revision whose
status was PUBLISHED, and every revision referenced by a restore. Retention
deletes only eligible old non-published revisions using a guarded database
setting; all remaining history rejects UPDATE and DELETE at the database
boundary. Existing content is backfilled as revision 1 during migration,
using its last-updated timestamp as the baseline revision time.
Draft content deletion also removes its revision history; any content with a
PUBLISHED revision or publication snapshot cannot be deleted.

## Working drafts of a published Page

A published Page stays PUBLISHED and locked. Public APIs, navigation and
Next.js rendering keep serving its latest `PublishedContentSnapshot`, path
and metadata until a reviewed publication of a working draft commits.

An AUTHOR opens at most one working draft with
`POST /api/v1/sites/{site_pk}/pages/{id}/working-draft/`. The request requires
the published Page's current `If-Match` ETag: a missing precondition returns
428 and a stale ETag returns 409. The response is a normal DRAFT Page copied
from that serving snapshot. `draft_of` points at the published Page, the
draft uses an internal `wip-` slug with no parent, and repeating the call
returns the same open draft. Archived drafts do not count as open. The
draft is Site-scoped: another Site's identifier returns 404, and a caller
without the AUTHOR role on this Site is denied.

The AUTHOR edits that draft with the existing Page PATCH. Submit, reject,
approve, archive and the author/reviewer separation use the existing
workflow. The author and submitter still cannot approve it.

Publishing an approved working draft does not publish the internal route.
In one transaction the PUBLISHER copies the draft title, blocks, block
schema version, metadata, SEO, layout and visibility onto the published
Page, writes the next immutable snapshot, bumps that Site and locale
publication version, records `CONTENT_PUBLISHED` for the live Page, and
archives the working draft. The live Page id, slug, path, parent and
homepage flag do not change. The database allows that copy only while the
publication service sets `cms.apply_working_draft` for the transaction, and
only while the row stays PUBLISHED. Concurrent publishes serialize on the
draft and the live Page; a second or stale publish fails because the draft
is no longer APPROVED. If the snapshot cannot be written, or the live Page
is no longer PUBLISHED, the transaction rolls back and the previous snapshot
and cache generation stay in place.

Unpublish and archive of the live Page are unchanged. Unpublish keeps the
snapshot and `published_at` but stops public delivery. A working draft
cannot be published onto a Page that is not currently published. Archiving
the working draft discards that copy and leaves the live snapshot. Posts do
not use `draft_of` and keep the shared publish path.

Existing Pages gain an empty `draft_of`. Published snapshots are not
rewritten by the migration.

## Authorization boundary

The backend has validated global Keycloak realm/client roles and persisted
Site-scoped AUTHOR, REVIEWER and PUBLISHER assignments. Only a validated
platform-admin token may manage assignments. Page workflow actions on these routes also require the PAGES module to be
available for that Site. A disabled module returns `400` with
`details.reason` `module_disabled` and leaves the Page row in place. Public
delivery stays closed. The routes do not bypass that gate.

## Verification

Automated tests cover the state matrix, Site-scoped role denial, author /
reviewer separation, rejection comments and editability, direct transition
protection, audit records, immutable snapshots, publish retries, concurrent
publishes and rollback when snapshot creation fails. Revision tests cover
snapshot capture, restore, Site authorization/isolation, optimistic edit
conflicts, immutable published history, retention, and the snapshot-size cap.
