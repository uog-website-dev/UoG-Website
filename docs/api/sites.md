# Site administration API

Contract: [OpenAPI snapshot](openapi.yaml), live `/api/schema/`, interactive
`/api/docs/` and `/api/redoc/`. Errors: [catalog](error-catalog.md).

This is the restricted interim administration API for institutional websites.
Every operation, including reads, requires a valid Keycloak bearer token with
the `platform-admin` realm role. Django staff or superuser sessions do not
grant access. Anonymous calls return 401. An authenticated token without
`platform-admin` returns 403.

Writes require **both** `DEBUG=True` and `ORGANIZATIONS_DEV_WRITES_ENABLED=True`.
The opt-in defaults to False. With either flag off, writes return 403 and
reads stay available to platform-admin. Production writes stay closed until
scoped IAM/RBAC exists. There is no unauthenticated mutation and no second
write flag.

JSON is the only request and response format. Responses are `private, no-store`.
No PUT or DELETE is supported (405). `Idempotency-Key` is rejected with 400.
Pagination uses `?page=`, 20 rows per page, and `{count,next,previous,results}`.
Unknown, repeated, or invalid list parameters return 400. An unknown page
returns 404.

Creates return 201 with `Location` and a strong `ETag`. Detail reads return
200 and `ETag`. PATCH and detail POST actions require that exact `ETag` in
`If-Match`, checked inside the same transaction and row lock as the change.
A missing header is 428. A mismatch is 412. Duplicate codes, hostnames, and
Site/module pairs return 409.

A domain or SiteModule id requested under another Site returns 404.

| Method | Path | Success |
| --- | --- | --- |
| GET, POST | `/api/v1/sites/` | 200 list, 201 create |
| GET, PATCH | `/api/v1/sites/{id}/` | 200 |
| POST | `/api/v1/sites/{id}/activate/`, `suspend/`, `archive/` | 200 |
| PATCH | `/api/v1/sites/{id}/configuration/` | 200 |
| GET, POST | `/api/v1/sites/{site_pk}/domains/` | 200 list, 201 create |
| GET, PATCH | `/api/v1/sites/{site_pk}/domains/{id}/` | 200 |
| POST | `.../domains/{id}/activate/`, `deactivate/`, `set-primary/` | 200 |
| GET, POST | `/api/v1/sites/{site_pk}/modules/` | 200 list, 201 enable |
| GET, PATCH | `/api/v1/sites/{site_pk}/modules/{id}/` | 200 |
| POST | `.../modules/{id}/enable/`, `disable/` | 200 |
| GET, POST | `/api/v1/site-templates/` | 200 list, 201 create |
| GET, PATCH | `/api/v1/site-templates/{id}/` | 200 |
| GET, POST | `/api/v1/modules/` | 200 list, 201 register |
| GET, PATCH | `/api/v1/modules/{id}/` | 200 |
| GET | `/api/v1/site-context/` | 200 |

`GET /api/v1/site-context/` is public. It reports the Site, hostname,
public display name and theme, and enabled module codes selected from the
browser Host. Platform hosts return
a null site. Unknown, draft, suspended and archived hosts never reach it
(404). The body is routing context, not an authorization decision. Administration
writes remain platform-admin and development-opt-in only.

Lifecycle, domain activation, primary designation, and module enable/disable
bodies are `{}`. Deactivating an alias is `{}`. Deactivating the active
primary domain requires `{"replacement": <other-domain-id>}`.

## Sites

List filters: `search` (name or code), `code`, `status`, `organization_unit`,
`ordering` (`code`, `name`, `status`, `created_at`, `updated_at`), `page`.
Default order is `code`.

Create starts in `DRAFT`. `code` is trimmed and uppercased. Optional
`template` must be ACTIVE; its approved defaults are copied once.
`configuration` on create is an optional allowlisted merge onto that copy.
Later template edits do not change the Site. PATCH may change name,
short name, language, owner, main flag, and template. Code, status, and
configuration are not writable there.

`POST .../activate/`, `suspend/`, and `archive/` follow the Site lifecycle
and run under the hierarchy write lock. `PATCH .../configuration/` merges
one allowlisted change into that Site only, in the same lock as `If-Match`.

## Domains

Hostnames are normalized and globally unique. A duplicate returns 409.
`is_primary` and, on update, `hostname` are not body fields.
`POST .../set-primary/` clears the previous primary and sets this domain
inside one domain lock. `POST .../deactivate/` with an empty body turns off
an alias. The active primary cannot be deactivated until `replacement`
names another active domain on the same Site; that domain becomes primary
and the previous one becomes inactive in the same transaction. A domain id
from another Site is rejected. Creates, updates, primary changes and
deactivations are written to the shared audit log as `sites.sitedomain`
events. A primary cannot set `redirect_to_primary`.

List filters: `hostname`, `status`, `is_primary`, `ordering`
(`hostname`, `status`, `is_primary`), `page`.

## Templates and modules

Template and module lists accept `search`, `code`, `status`, `ordering`, and
`page`. Modules also accept `is_enabled`. New templates default to
`INACTIVE`. Codes are immutable after create. Editing a template does not
rewrite Sites that were provisioned from it.

The module registry lists planned capabilities. A planned module cannot be
marked implemented or globally enabled unless that code is already a shipped
capability. Registering or editing a row does not implement the feature.
Seeded CMS, media, staff directory, academics, news, events, jobs, search,
and analytics rows stay planned until a shipped capability exists.

`POST /api/v1/sites/{site_pk}/modules/` enables one usable module for that
Site. Usable means implemented, globally enabled, and shipped. Each enablement
row includes read-only `module_code`, so a Site administrator can tell
PAGES, POSTS and MENUS apart without the central registry. A planned or
globally disabled module returns 400. A second pair returns 409.
`disable` sets `is_enabled` false and keeps the row and configuration.
PATCH replaces that Site's module settings and does not toggle enablement.
Another Site's assignment id returns 404. List filters: `module`,
`is_enabled`, `ordering` (`module_id`), `page`.
