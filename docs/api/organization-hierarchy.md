# Organization hierarchy API

All endpoints require a verified Keycloak `platform-admin` bearer token,
including in production. Staff sessions and ordinary authenticated users
do not grant access. These read-only endpoints do not require the development
write opt-in. Existing write/lifecycle protections are unchanged.

| GET path | Included records | Order |
| --- | --- | --- |
| `/api/v1/organizations/tree/` | Full visible tree, including University root | Breadth-first, code ascending within depth |
| `/api/v1/organizations/{id}/children/` | Direct children, excluding self | Code ascending |
| `/api/v1/organizations/{id}/ancestors/` | Ancestors, excluding self | Root first, then toward the selected unit |
| `/api/v1/organizations/{id}/descendants/` | All descendants, excluding self | Breadth-first, code ascending within depth |
| `/api/v1/organizations/{id}/subtree/` | Selected unit and all descendants | Self first, then breadth-first/code |

The response is a flat adjacency list. Each `results` entry has exactly the
same fields and field meanings as the [Organization representation](organizations.md).
`parent` links connect entries without recursively nested JSON or duplicated
ancestor objects. `count` is the number of returned records, not a separate
database total. For a three-level University → College → Department hierarchy,
`tree/` returns all three; the Department's `ancestors/` returns University
then College; the College's `descendants/` returns Department; its `subtree/`
returns College then Department. The University's `children/` returns College.

Example leaf children response:

```json
{"count": 0, "results": []}
```

An empty database returns that same body for `tree/`. Root ancestors and
leaf descendants are empty. A leaf subtree contains the leaf itself.
Unknown or unauthorized anchor IDs return the standard 404 envelope. All
hierarchy responses are `private, no-store` and include `X-Request-ID`.
They do not provide an ETag for use in mutations: obtain that from GET detail.

ACTIVE, INACTIVE and ARCHIVED records are all included. No implicit status
filter disconnects historical parent links. Filtering, client sorting,
pagination, caller-selected limits and depth truncation are not supported
on these operations. Unknown query parameters do not activate those features.
Use the ordinary list endpoint for [search, filters and pagination](organization-discovery.md).

Each hierarchy response has a maximum of **1,000 nodes**, including self
where applicable. Exactly 1,000 succeeds. A larger result returns **409
conflict** with no partial `results`, using the [standard error envelope](error-catalog.md).
Its `error.details` includes a detail message and `max_nodes: "1000"`
(DRF error detail values are strings). Clients can navigate smaller subtrees
or direct children; if one unit itself has more than 1,000 direct children,
use the paginated ordinary list with `?parent={id}`. Never interpret a capped
response as a complete tree: overflow is explicit rather than truncated.

Traversal uses one recursive PostgreSQL query bounded to limit + 1 returned
IDs, followed by batched authorized hydration/type joins and parent visibility
checks. There is no query per node, recursion level or organization type.
The direct-children query does not recurse. Ordering is applied only after
the bounded ID result is accepted. The database may still scan/materialize
the visible set to traverse a large structure; the cap limits response size
and application hydration, not a guarantee of constant database work. This
adjacency-list approach reuses the indexed parent FK and existing cycle
protection. No tree library or schema migration is introduced.

Traversal, hydration and parent-visibility checks are separate ordinary
READ COMMITTED queries. Concurrent hierarchy edits can change the structure
between reads; the API does not promise a transaction-wide snapshot or a
cached tree revision. Refresh when coordinating with concurrent writers.

## Authorization integration contract

Scoped IAM/RBAC is not implemented by this story. Until it is, these
endpoints remain restricted to the existing global platform administrator
role; no organization header grants access. The selector explicitly takes
the view's authorized queryset and intersects it at every traversal step and
again when hydrating. Traversal stops at a hidden node and does not bridge
through it to reveal its ancestors or descendants. A hidden anchor returns
404. Counts describe only visible returned records.

For a future scoped view, `tree/` returns a forest of visible components.
A visible node whose parent is hidden has `parent: null` in the response,
preventing exposure of that parent's ID. This presentation boundary does not
modify the stored parent or create a second institutional root. Other visible
parent IDs may refer outside a particular children/ancestor response, as
expected for a partial traversal.

Before broadening the role gate, implement membership-aware queryset
filtering in `get_queryset()` for **all** operations. Per-object checks on
the requested anchor alone are insufficient. If the future policy adds
field-level restrictions, apply the same authorized representation to every
returned node. Tests in `backend/tests/test_organization_hierarchy_api.py`
exercise excluded intermediate nodes, hidden parent IDs, hidden anchors,
three levels, lifecycle inclusion, fixed query counts, and a real 1,001-node
structure. These are integration safeguards, not a claim of completed RBAC
or Site authorization.

## Schema and verification

Use `/api/docs/`, `/api/redoc/` or `/api/schema/`. The committed
[OpenAPI snapshot](openapi.yaml) describes each response, ordering, limit
and authentication/error contract. The existing Azure job validates the
generated schema, checks snapshot equality and publishes `openapi-schema`.

```console
docker compose exec -T backend pytest -o addopts='' -q
docker compose exec -T backend python manage.py spectacular --file /tmp/openapi.yaml --validate --fail-on-warn
```

No migration is required. Existing organization migrations through
`0005_lifecycle_rules` remain the database reference. Hosted CI and a merged
PR/commit must be attached after pushing/review; local checks do not establish
those external results.

### Local completion evidence (2026-10-23)

- Complete PostgreSQL-backed Docker suite: **230 passed in 63.38s**
  (`pytest -o addopts='' -q`), including the 20 new hierarchy API cases and
  all earlier organization/authentication/documentation regression tests.
- `manage.py check`, `makemigrations --check --dry-run` and
  `migrate --check`: exit 0. No migration or pending model changes.
- `spectacular --validate --fail-on-warn` under `DEBUG=False`: exit 0.
  The schema has 20 operations across 14 paths and matches the committed
  snapshot. The existing CI schema validation/snapshot check covers these
  new paths without a separate pipeline.
- Docker services remain running and healthy where health checks exist.
  Through Nginx, health, Swagger and schema return 200; anonymous tree and
  children requests return 401.
- No regression detected locally. Merged PR/commit and hosted CI result
  remain pending; no remote merge or pipeline success is claimed.
