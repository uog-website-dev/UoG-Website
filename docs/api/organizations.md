# Organization administration API

Contract: [OpenAPI snapshot](openapi.yaml), live `/api/schema/`, interactive
`/api/docs/` and `/api/redoc/`. Errors: [catalog](error-catalog.md).
Hierarchy navigation is documented in the [hierarchy API contract](organization-hierarchy.md).
Significant changes use the [shared transactional audit contract](organization-audit.md).

This is the restricted interim administration API, using the same verified
Keycloak `platform-admin` role as `/api/admin/overview/`. Every operation,
including reads, requires a valid bearer token with this role. Django staff
or superuser sessions do not grant access. There is no public write bypass.
These are institutional administration operations, without Site scope or
module activation. Site administration is a separate contract
([Site APIs](sites.md)); scoped RBAC remains later work.

Writes require **both** `DEBUG=True` and
`ORGANIZATIONS_DEV_WRITES_ENABLED=True`. The opt-in defaults to False. With
`DEBUG=False`, all writes return 403 even if the opt-in is True. Production
writes are not releasable until scoped IAM/RBAC is implemented and tested.
Production documentation retains the separate disabled-by-default/staff-only
policy described in [documentation access](../development/api-documentation.md).

| Method | Path | Success |
| --- | --- | --- |
| GET | `/api/v1/organizations/` | 200 paginated list |
| POST | `/api/v1/organizations/` | 201, Location and ETag |
| GET | `/api/v1/organizations/{id}/` | 200 and ETag |
| PATCH | `/api/v1/organizations/{id}/` | 200 and new ETag |
| POST | `/api/v1/organizations/{id}/deactivate/` | 200 and new ETag |
| POST | `/api/v1/organizations/{id}/archive/` | 200 and new ETag |

No PUT or DELETE is supported (405). The earlier reserved unversioned
`/api/organizations/` remains unavailable. IDs use the existing BigAutoField
strategy. JSON is the only accepted body and response format. Responses are
`private, no-store`. Pagination uses `?page=2`, 20 rows per page, and the
standard `{count,next,previous,results}` envelope. Default ordering is code
ascending, including archived units. The list now supports documented
[search, filters and ordering](organization-discovery.md); invalid, unknown
or repeated list parameters return 400.

Creation example (parent 1 must already be the ACTIVE University root):

```json
{
  "code": "INFORMATICS",
  "name": "College of Informatics",
  "short_name": "CoI",
  "organization_type": "COLLEGE",
  "parent": 1,
  "description": "College of Informatics",
  "metadata": {}
}
```

`organization_type` uses the immutable lookup code, not a lookup database ID.
The seeded codes are UNIVERSITY, COLLEGE, SCHOOL, INSTITUTE, DEPARTMENT,
RESEARCH_CENTER, DIRECTORATE, OFFICE, ADMINISTRATIVE_UNIT and OTHER.
The first unit must be UNIVERSITY with `parent: null`; all subsequent units
require a valid parent and cannot be UNIVERSITY. See [lifecycle rules](../architecture/organization-lifecycle-rules.md).

Example 201 response (IDs/timestamps are illustrative):

```json
{
  "id": 2,
  "code": "INFORMATICS",
  "name": "College of Informatics",
  "short_name": "CoI",
  "organization_type": "COLLEGE",
  "parent": 1,
  "description": "College of Informatics",
  "status": "ACTIVE",
  "metadata": {},
  "created_at": "2026-10-23T12:00:00Z",
  "updated_at": "2026-10-23T12:00:00Z"
}
```

Codes trim whitespace, normalize to uppercase and are immutable. Unknown
fields, read-only fields and code in PATCH are rejected with 400. Name is
required; metadata must be a JSON object. Status is read-only: use the
lifecycle actions with `{}` as the JSON body. No fields for domains, themes
or website configuration are accepted. ACTIVE → INACTIVE → ARCHIVED is
enforced by the existing domain and database rules. Root changes, cycles,
active descendants and the future Site integration contract remain protected.
Historical records are retained; actions never silently cascade.

Every PATCH and lifecycle POST requires the **exact strong ETag** from the
current GET detail in `If-Match`. Missing precondition returns 428; stale,
weak or wildcard values return 412. A single exact tag is the accepted
contract; lists of tags are not accepted. Comparison, validation and mutation
occur under the common transactional hierarchy lock. Simultaneous PATCH
requests using the same tag have one winner; the other must retrieve and
reconcile. Name/metadata corrections are allowed on archived units, while
their parent/type remain frozen. Successful mutations return the new tag.
CORS permits `If-Match` and exposes `ETag`, `Location` and `X-Request-ID`.

No retry-sensitive integration create has been identified, so this story
does not add an idempotency store or claim replay semantics. `Idempotency-Key`
on create is rejected with 400. A retry of an already committed normalized
code returns 409 and creates no duplicate. After a lost create response,
query the authorized paginated list with `?code={code}` and reconcile the unique code before
retrying. Do not blindly retry a create or stale PATCH. Database transaction
conflicts return 409 without leaking SQL details.

For local testing, set the opt-in in `.env`, then run
`docker compose up -d --no-deps backend`. Obtain a token with the existing
[development token workflow](../development/api-documentation.md), open
Swagger, select **Authorize**, and paste the JWT. Create the root if absent,
then a child. GET detail, copy the quoted ETag response header, and provide
it in the PATCH/action `If-Match` field. Swagger authorization never changes
backend permissions. Stop development writes by setting the opt-in False
and recreating the backend again.

No schema migration is required by this API story. It consumes organization
migrations `0001`–`0005`. Run the complete PostgreSQL-backed suite with
`docker compose exec -T backend pytest`; API tests include real signed
tokens and simultaneous conditional PATCH requests. Hosted CI and merge
evidence must be attached after the branch is pushed and reviewed.

## Initial management API verification (2026-10-23, before hierarchy/discovery)

- Complete backend regression suite inside Docker against PostgreSQL:
  `210 passed in 41.09s` (`pytest -o addopts='' -q`). Includes all earlier
  foundation, type, entity, hierarchy, lifecycle, authentication and docs tests.
- API tests cover anonymous/non-admin/session rejection, production denial
  even with opt-in, pagination, normalized duplicate-code conflict, field
  validation, root/cycle/lifecycle failures, retained references and concurrent
  PATCH with one 200 and one 412.
- `manage.py check`, `makemigrations --check --dry-run` and `migrate --check`:
  exit 0. No new migration; existing organization migrations through
  `0005_lifecycle_rules` remain the database reference.
- `spectacular --validate --fail-on-warn` with CI's `DEBUG=False`: exit 0.
  At that point, the generated snapshot contained 15 operations across nine paths, including
  six Organization operations. Azure CI validates and publishes the schema
  and checks it against `docs/api/openapi.yaml`.
- Running Docker stack: health, Swagger, ReDoc and schema return 200 through
  Nginx; anonymous Organization access returns 401. Backend, PostgreSQL,
  Keycloak and other health-checked services are healthy.
- No regression detected in the local automated checks. Hosted pipeline
  result and merged PR/commit are **pending**; this implementation remains
  in the working tree and does not claim remote CI or merge completion.
