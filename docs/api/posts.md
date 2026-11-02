# Post authoring and workflow API

Posts and their Categories/Tags are scoped to the Site in the request path.
The Post admin and taxonomy routes are listed in the
[OpenAPI contract](./openapi.yaml) and require an active Site CMS role (or the
validated platform-admin role) plus the `POSTS` module enabled for that Site.

## Shared workflow

Use the shared content action route for a Post:

```text
POST /api/v1/cms/sites/{site_pk}/content/{content_id}/workflow/
```

Workflow roles come from active assignments on that Site. Request-body roles
are rejected. An author or submitter cannot review their own content.

| Action | Required Site role | From | To |
| --- | --- | --- | --- |
| `submit` | AUTHOR | DRAFT | IN_REVIEW |
| `approve` | REVIEWER | IN_REVIEW | APPROVED |
| `reject` | REVIEWER | IN_REVIEW | DRAFT |
| `publish` | PUBLISHER | APPROVED | PUBLISHED |
| `unpublish` | PUBLISHER | PUBLISHED | UNPUBLISHED |
| `restore` | AUTHOR | UNPUBLISHED | DRAFT |
| `archive` | PUBLISHER | APPROVED, PUBLISHED or UNPUBLISHED | ARCHIVED |

The transition, audit event, immutable publication snapshot and cache
generation update commit together. A retry of `publish` for an already
published Post returns its current representation without creating another
snapshot, workflow entry, audit event or cache generation. Unpublishing
advances the publication generation and invalidates menu delivery caches for
menus that reference the Post, including inheriting Sites.

Public menu delivery includes a Post link only while its Post is PUBLISHED.
Draft, in-review, approved, unpublished and archived Posts are omitted. The
workflow endpoint is gated by `POSTS`; turning off `PAGES` does not disable Post
workflow.

## Verification

The backend tests cover the role flow, Site module gate, Post snapshot payload,
audit events, publication retry, concurrent publish retries, draft visibility
and linked-menu cache invalidation. Scheduled publishing is not implemented;
it is optional scope for this API.
