# Shared CMS review and publishing workflow (P2-CMS-004)

Pages and future Posts share one status machine on `SiteContent`. Status
changes go through `apps.cms.services.workflow.transition_content`; direct
model status changes are rejected, and PostgreSQL triggers enforce the state
edges, audit each accepted status change, and protect the public payload.
PAGES and POSTS remain planned/disabled content-serving capabilities. The
workflow administration API is mounted at `/api/v1/cms/sites/`; it does not
expose generic content CRUD or public serving. Requests pass validated
Keycloak role claims and the authenticated actor into the shared service;
client-supplied role names are rejected and never used for authorization.

## HTTP integration

| Method and path | Access | Contract |
| --- | --- | --- |
| `GET /api/v1/cms/sites/{site_pk}/content-roles/` | platform-admin token role | List CMS role assignments for this Site |
| `POST /api/v1/cms/sites/{site_pk}/content-roles/` | platform-admin token role | Assign an active local user AUTHOR, REVIEWER or PUBLISHER |
| `DELETE /api/v1/cms/sites/{site_pk}/content-roles/{assignment_id}/` | platform-admin token role | Revoke only an assignment owned by the path Site |
| `POST /api/v1/cms/sites/{site_pk}/content/{content_id}/workflow/` | authenticated token plus required Site CMS role or platform-admin | Apply one workflow action; content is looked up under the path Site |

The action body accepts only `action` and optional `comment`. The endpoint
derives its role set from validated bearer-token claims and rejects unknown
fields, including attempted `roles` injection. Foreign-Site content and
assignments return 404 rather than exposing their existence. The generated
OpenAPI snapshot documents these routes and their request/response shapes.

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
cannot approve or reject content they authored or submitted. `platform-admin`
is accepted only from validated token claims; `is_staff` and `is_superuser`
flags do not grant workflow rights. Site-specific roles are represented by
unique `(site, user, role)` assignments in `SiteContentRoleAssignment`.

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
those states. After unpublishing, an authorized editor can revise and restore
the content to DRAFT for another review cycle.

Every successful publication writes a `PublishedContentSnapshot` containing
the complete serving payload and a monotonically increasing per-content
version. Snapshots cannot be updated or deleted, and each SiteContent row lock
serializes the version allocation. Existing published records are backfilled
as version 1 by the workflow migration. `published_at` retains the first
publication time; each snapshot has its own publication timestamp.

## Authorization boundary

The backend currently has validated global Keycloak realm/client roles and
no Site-user assignment API. This workflow adds persisted Site-scoped
AUTHOR, REVIEWER and PUBLISHER assignments. Until a future IAM endpoint
manages those assignments and CMS routes are enabled, only trusted backend
services/admin tooling can provision them. The content module registry remains
PLANNED, so adding this workflow does not activate CMS APIs or bypass module
gates.

## Verification

Automated tests cover the state matrix, Site-scoped role denial, author /
reviewer separation, rejection comments and editability, direct transition
protection, audit records, immutable snapshots, publish retries, concurrent
publishes and rollback when snapshot creation fails.
