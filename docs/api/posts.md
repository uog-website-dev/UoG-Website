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

## Public delivery

Public feeds resolve the Site from the trusted request Host; forwarded-host
headers and Site IDs in query strings do not select a tenant.

```text
GET /api/v1/site-context/posts/?category=news&tag=campus&page=1&page_size=20
GET /api/v1/site-context/posts/{slug}/
```

Feeds include only `PUBLISHED` Posts and use immutable publication snapshots,
ordered by publication time descending with UUID as a stable tie-breaker.
Category and Tag filters accept active taxonomy slugs owned by the resolved
Site and locale. The list includes excerpt, featured media, SEO and taxonomy
metadata; detail also includes the Post body. Responses are paginated (default
20, maximum 100), vary by Host and use a Site/locale publication generation
for cache keys. Publish, unpublish and archive of a published Post advance that
generation. Disabling `POSTS` makes both public routes return not found.

The public feed, detail, taxonomy isolation, draft visibility, deterministic
pagination, Host resolution, module gate and cache invalidation are covered by
`apps/cms/tests/test_public_posts.py`.

## Verification

The backend tests cover the role flow, Site module gate, Post snapshot payload,
audit events, publication retry, concurrent publish retries, draft visibility
and linked-menu cache invalidation. Scheduled publishing is not implemented;
it is optional scope for this API.
