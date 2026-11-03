# Post authoring and workflow API

Posts and their Categories/Tags are scoped to the Site in the request path.
The Post admin and taxonomy routes are listed in the
[OpenAPI contract](./openapi.yaml) and require an active Site CMS role, or an
active database platform-administrator assignment, plus the `POSTS` module
enabled for that Site. A Keycloak realm role does not grant Post access.
Menus use `menu.read`, `menu.write`, and `menu.publish` from the same
database assignment contract and do not accept a realm-role bypass.

## Authoring data

Create and update Post drafts through `/api/v1/sites/{site_pk}/posts/`. The
payload accepts `title`, `slug`, `excerpt`, `content`, `blocks`, `seo`,
`featured_media`, `categories`, and `tags`. `blocks` use the shared CMS block
schema used by Pages; rich text is sanitized on write and the preview renderer
renders text and safe links without inserting arbitrary HTML. SEO accepts only
`meta_title`, `meta_description`, and `og_image_ref`.

Category and Tag IDs must belong to the same Site as the Post. Featured media
and `og_image_ref` references may use `sites/{site_pk}/...` or the platform
`shared/...` scope; other Site references and external URLs are rejected. The platform does not
currently provide a media upload or picker API, so these references must point
to assets provisioned by the existing deployment process. Taxonomy create
requests use the corresponding Site categories or tags route and require an
authorized Site author role and the enabled `POSTS` module.

Authoring responses include `available_actions`. That list is the set of
workflow buttons the current caller may attempt. It is derived from the Site
CMS role assignments. An author does not see approve or reject on their own
submission. The workflow service remains the authority.

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

Public Post feeds resolve the Site from the trusted request Host; forwarded
host headers and Site IDs in query strings do not select a tenant.

```text
GET /api/v1/site-context/posts/?category=news&tag=campus&page=1&page_size=20
GET /api/v1/site-context/posts/{slug}/
```

The feed returns only published Posts for that Site and locale, ordered by
publication time descending with UUID as a stable tie-breaker. Category and Tag
filters accept active taxonomy slugs belonging to that Site and locale. List
responses are paginated (default 20, maximum 100), include excerpt, featured
media, SEO and taxonomy metadata, and use immutable publication snapshots;
detail responses also include the Post body. Responses vary by Host and server
cache keys include the Site and locale publication generation. Publishing or
unpublishing advances that generation. A disabled `POSTS` module suppresses
both routes with not found.

## Public website

The public Next.js site renders the host-resolved feed at `/posts` and one
Post at `/posts/{slug}`. Category and tag filters are slugs for the resolved
Site. Drafts, another Site's Posts, and a disabled POSTS module are not
rendered. Body HTML is shown as text plus links whose targets are same-site
paths or http(s) URLs.

## Verification

The backend tests cover the role flow, Site module gate, Post snapshot payload,
audit events, publication retry, concurrent publish retries, draft visibility,
public feed/detail isolation, taxonomy filters, pagination, Host resolution,
cache invalidation, and XSS sanitization. The admin console tests cover
submit, publish, Site isolation, the disabled module, and the private preview.
The public renderer tests cover the feed, detail, draft omission, keyboard
focus, and unsafe HTML. Scheduled publishing is not
implemented; it is optional scope for this API.
