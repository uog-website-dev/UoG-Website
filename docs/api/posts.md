# Post authoring and workflow API

Posts and their Categories/Tags are scoped to the Site in the request path.
The Post admin and taxonomy routes are listed in the
[OpenAPI contract](./openapi.yaml) and require an active Site CMS role, or an
active database platform-administrator assignment, plus the `POSTS` module
enabled for that Site. A Keycloak realm role does not grant Post access.
Menus use `menu.read`, `menu.write`, and `menu.publish` from the same
database assignment contract and do not accept a realm-role bypass.

## Authoring data

Create and update Post drafts through `/api/v1/sites/{site_pk}/posts/`. Prefer
the versioned article body `editor_document` (`schema_version: 1` + sanitized
`html`) for paragraphs, H2–H4, emphasis, lists, quotations and safe hyperlinks.
The server normalizes and sanitizes that document, stores a recoverable copy
under Post metadata, and mirrors sanitized HTML into `content`. Legacy
`content`/`blocks` payloads remain accepted for older drafts. Updates require
an `If-Match` ETag (`cms-content-{id}-r{revision}`); a stale ETag returns
**409**. See [Post editor](../post-editor.md) for the full contract.

Also accepted: `title`, `slug`, `excerpt`, `seo`, `featured_media`,
`categories`, and `tags`. SEO accepts only `meta_title`, `meta_description`,
and `og_image_ref`.

Slug rules: lowercase letters, digits and single hyphens; unique per Site and
language; reserved values such as `new`, `edit`, `admin`, `api`, `preview`,
`feed`, `search`, `rss`, `atom` and `index` are rejected with a field-level
`slug` error. The same slug may exist on different Sites. While a Post is in
review, approved, published or archived, title, permalink, excerpt, body,
SEO, featured media, categories and tags are locked until workflow returns it
to an editable state—so draft metadata changes never alter the live published
snapshot or public `/posts/{slug}` route.

Category and Tag IDs must belong to the same Site as the Post and be active.
Featured media and `og_image_ref` references may use `sites/{site_pk}/...` or
the platform `shared/...` scope; other Site references and external URLs are
rejected. Use the Site media library to manage approved assets and the existing
featured-media reference contract. Taxonomy create requests use the corresponding Site
categories or tags route and require an authorized Site author role and the
enabled `POSTS` module.

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
media, optional public author byline, SEO and taxonomy metadata, and use
immutable publication snapshots; detail responses also include the Post body.
Draft status, workflow actions and author account ids are never exposed.
Responses vary by Host and server cache keys include the Site and locale
publication generation. Publishing or unpublishing advances that generation. A
disabled `POSTS` module suppresses both routes with not found.

## Public website

The public Next.js site renders the host-resolved feed at `/posts` and one
Post at `/posts/{slug}`. Category and tag filters are slugs for the resolved
Site. Drafts, another Site's Posts, and a disabled POSTS module are not
rendered. The article detail shows the published title, body, publication
date, optional public author byline when present, taxonomy, and featured
image (omitted cleanly when media is missing or unavailable), with
navigation back to `/posts`. Document title and description come from Post
SEO fields. Versioned article bodies preserve supported headings, lists,
quotations and emphasis through the shared safe renderer. Legacy bodies
retain their text and safe-link rendering.

## Verification

Featured images use canonical Site MediaAsset references and the `featured_alt` input. Version 1 editor documents support inline images with an asset UUID, a distinct placement UUID and alternative text. The Site Media Library picker and existing upload flow provide these identities. Saves and publication revalidate image eligibility, and retained revisions protect their referenced assets. [Article media contract](../post-media.md)

The backend tests cover the role flow, Site module gate, Post snapshot payload,
audit events, publication retry, concurrent publish retries, draft visibility,
public feed/detail isolation, taxonomy filters, pagination, Host resolution,
cache invalidation, and XSS sanitization. The admin console tests cover
submit, publish, Site isolation, the disabled module, and the private preview.
The public renderer tests cover the feed, detail, draft omission, keyboard
focus, and unsafe HTML. Scheduled publishing is not
implemented; it is optional scope for this API.

## Editor review and working drafts

The Post editor presents backend-derived workflow controls and private saved-revision preview. A published article can open a working copy through `POST /api/v1/sites/{site}/posts/{post}/working-draft/` with its current ETag. Promotion retains the original public ID and permalink, commits the new publication and archives the reviewed copy. Private preview uses `GET /api/v1/sites/{site}/posts/{post}/preview/`. Responses include `draft_of`, `publication_slug`, `publication_status`, `review_comment` and `last_publication_at`. [Workflow contract](../post-workflow.md)
