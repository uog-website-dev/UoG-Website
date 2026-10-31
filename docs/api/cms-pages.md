# CMS Page authoring and delivery API

The Page API exposes authorized authoring by Site and published-only public
delivery. It reuses the shared block schema, workflow, revision history and
immutable publication snapshots.

## Authoring

All authoring routes require a validated Keycloak bearer token and an active
CMS role on the Site named in the path. AUTHOR may create and edit; AUTHOR,
REVIEWER and PUBLISHER may list and inspect. A platform administrator with an
active database assignment can perform all actions; the validated legacy
`platform-admin` token role is also supported. Client-supplied roles are not
accepted.

Every authoring, workflow and revision route is also gated on the `PAGES`
module being enabled for the Site. When it is disabled, those requests are
refused with a field-level 400 (`module`) and public delivery returns the same
404 as an unknown route; nothing is deleted, and re-enabling the module
restores access to the same Pages.

| Method and path | Contract |
| --- | --- |
| `GET /api/v1/sites/{site_pk}/pages/` | Filtered, paginated list scoped to one Site |
| `POST /api/v1/sites/{site_pk}/pages/` | Create a DRAFT Page |
| `GET /api/v1/sites/{site_pk}/pages/{id}/` | Read a Site-owned Page and its current ETag |
| `PATCH /api/v1/sites/{site_pk}/pages/{id}/` | Update a DRAFT or UNPUBLISHED Page; requires `If-Match` |
| `POST /api/v1/sites/{site_pk}/pages/{id}/workflow/` | Apply a validated workflow action |
| `GET /api/v1/sites/{site_pk}/pages/{id}/workflow-history/` | Read the private, append-only transition timeline and review comments |
| `POST /api/v1/sites/{site_pk}/pages/{id}/homepage/` | Make a draft or unpublished Page this Site's homepage |

Create, edit, workflow and homepage assignment require PAGES to be
implemented, globally enabled and enabled for that Site. When it is off,
those writes return `400` with `details.reason` `module_disabled`. List and
detail still return the existing rows. Public delivery returns the same 404
as an unknown Page. Nothing is deleted.

List filters are `search`, `status`, `visibility`, `locale`, `parent` and
`ordering`. `page` and `page_size` pagination defaults to 20 and is capped at
100. Unknown or repeated parameters return field-level 400 errors. Site,
status, computed path, authorship, publication time and revision numbers are
server managed. Parent Pages must share the Site and locale. Editing a parent
records redirects for affected routes and is rejected if it would create a
cycle or cross-Site hierarchy.

The Site admin list uses the paginated response's `results` for Page rows and
`count` for navigation. Its status dashboard obtains each total by requesting
the list with that `status`, `page=1` and `page_size=1`; the returned `count`
is the total for the whole Site, not just the current page. Page rows include
the title, computed path, status, locale, `created_by` author id and
`updated_at` timestamp used by the table.

The admin editor previews unpublished blocks inside the authenticated
administration session. Preview data is loaded through the authorized Site
Page API and is not exposed through public delivery routes.

Each detail response returns an ETag of the form
`"cms-content-{uuid}-r{revision}"`. Updates require that exact value in
`If-Match`: a missing precondition returns 428 and a stale value returns 409.
Cross-Site Page IDs return 404. Page route changes use route-history handling,
and every meaningful update creates a content revision.

### Example: create a draft

```http
POST /api/v1/sites/12/pages/
Authorization: Bearer <access-token>
Content-Type: application/json
```

```json
{
  "title": "Admissions",
  "slug": "admissions",
  "locale": "en-us",
  "blocks": [
    {"type": "heading", "level": 1, "text": "Apply to UoG"},
    {"type": "paragraph", "html": "<p>Applications are open.</p>"}
  ]
}
```

The response is a Page representation with `status: "DRAFT"`, `revision_number`,
an ETag and a `Location` header. Workflow actions use the shared state-machine
contract; for example, `{"action":"submit"}` begins review, while publishing
requires the REVIEWER and PUBLISHER stages.

Page representations include `available_actions`, calculated for the
authenticated user from their active Site CMS role, Page status and reviewer
separation rules. The admin review queue filters to `IN_REVIEW`; confirmation
dialogs collect rejection comments before submitting transitions. The UI uses
`available_actions` to decide which controls to show, but the workflow endpoint
rechecks authority and state on every request. A transition attempted after a
concurrent status change returns `409 conflict` with the current-state detail. The history endpoint
requires a Site CMS role (or platform-admin), is private and uncached, and
returns actor IDs, status changes, timestamps and comments.

## Public delivery

Public paths are mounted below `/api/v1/site-context/`. The Site comes only
from the active hostname selected by `SiteResolutionMiddleware`; a `site_id`
query parameter is rejected and never selects a tenant. The requested locale
must be enabled for that Site, otherwise the endpoint returns the same 404 as
an unknown Page.

| Method and path | Contract |
| --- | --- |
| `GET /api/v1/site-context/pages/` | Paginated PUBLIC Pages for the resolved Site and locale |
| `GET /api/v1/site-context/homepage/` | Published homepage snapshot |
| `GET /api/v1/site-context/pages/{page_path}/` | Published PUBLIC or UNLISTED route; old published routes redirect with 308 |

All public responses are built from the immutable `PublishedContentSnapshot`,
not from editable content. Listings omit UNLISTED and HIDDEN Pages. Direct
routes omit HIDDEN Pages. Unknown, draft and foreign-Site slugs share a
generic 404 response. Public delivery also requires that PAGES is implemented,
globally enabled and enabled for the resolved Site.

The public cache key contains the resolved Site, locale, resource and the
Site/locale publication generation. Publishing, unpublishing or archiving a
published Page advances that generation in the same transaction as the
workflow transition. Previous generation entries cannot be served after the
transition; the previous direct-route cache entry is deleted immediately.
Server-side cache entries expire after five minutes. HTTP responses require
revalidation by downstream caches and vary by Host.

See the generated [OpenAPI contract](./openapi.yaml), [block schema](../architecture/cms-content-blocks.md),
and [workflow contract](../architecture/cms-workflow.md).
