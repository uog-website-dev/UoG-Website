# Menu administration API

Menus and items are private Site-scoped administration resources under
`/api/v1/sites/{site_id}/menus/`. Swagger: `/api/docs/`; schema:
[`docs/api/openapi.yaml`](../api/openapi.yaml). Public delivery is a separate
contract in [menu delivery](menu-delivery.md). This administration API does
not render navigation.

## Authentication, permissions and activation

Use a valid Keycloak access token. In Swagger, select **Authorize**, paste the
JWT without `Bearer`, and use the ETag response header from Menu detail/tree
as the next request's `If-Match` value. Keycloak roles and Django staff/superuser
flags do not grant access. The actor needs active database application grants
covering the URL Site, its owning Organization subtree, or the platform.

| Code | Authority |
| --- | --- |
| `menu.read` | Read menus, item inventory and trees, including disabled historical records. |
| `menu.write` | Create inactive menus and mutate/delete draft structures. |
| `menu.publish` | Activate/deactivate menus. Active-menu structural changes require **both** `menu.write` and `menu.publish`. |

The backend entrypoint runs migrations as the migration role and then runs
`python manage.py seed_rbac`. Reconcile that catalog after deployment: the
standard platform, Organization and Site administrator roles receive all three
codes; Editor receives read/write, Publisher read/publish, and Viewer/Reviewer
read. This creates no user assignments. Existing `content.menus.*` catalog rows
are retained for compatibility but are **not** permission aliases for these APIs.

All mutations require MENUS to be shipped, globally enabled and enabled on the
Site. Disabling MENUS retains records and permits authorized administrative
inspection, but blocks content changes, moves, reorder, deletion and publication.
The separate module-management API permits authorized operators to re-enable it.
Menu activation does not publish linked Page/Post content.

## Routes

The base below is `/api/v1/sites/{site_id}/menus/`.

| Method | Relative route | Behavior |
| --- | --- | --- |
| GET, POST | base | Paginate menus / create an **inactive** menu. |
| GET, PATCH, DELETE | `{menu_id}/` | Inspect, edit name/location, or delete an empty menu. |
| GET | `{menu_id}/tree/` | Bounded preorder tree with parent IDs, Menu representation and version. |
| POST | `{menu_id}/reorder/` | Replace a complete sibling ordering in one transaction. |
| POST | `{menu_id}/activate/`, `{menu_id}/deactivate/` | Toggle availability, retaining items. Empty JSON body. |
| GET, POST | `{menu_id}/items/` | Paginate item inventory / append or insert an item. |
| GET, PATCH, DELETE | `{menu_id}/items/{item_id}/` | Inspect, edit link/label/active flag, or delete a leaf. |
| POST | `{menu_id}/items/{item_id}/move/` | Move a complete subtree and normalize affected sibling positions atomically. |

Creation returns `201` and `Location`; reads/updates/actions return `200`;
deletion returns `204`. PUT is unsupported. Scope, identifiers, timestamps,
Menu activation and versions are server-managed. Use activation actions for the
Menu active flag; use move/reorder for existing item parents and positions.
There is no cascading tree delete: nonempty menus and non-leaf items return
`409 children_present`; deactivation is the usual retention operation.

Locations are the controlled keys `header`, `footer`, `sidebar`, `primary`,
`secondary`. Exactly one Menu per `(Site, location)` is permitted, including
inactive menus. Duplicates return `409 duplicate_location` and never replace or
deactivate another Menu silently. The same location is valid in different Sites.

Lists use `page`, `page_size` (default 20, maximum 100), and optional `is_active`.
Menu order is location/UUID; item inventory order is sort_order/UUID. Tree
responses contain at most 1,000 items in preorder, with the same item shape as
CRUD. `include_inactive=true` is the tree default for editing. False hides an
inactive Menu and each inactive item's entire branch. No N+1 target fetching is
needed to compose the tree. Unknown/repeated query parameters are rejected.

## Version and tree operations

Every existing-Menu mutation, **including item creation**, requires the owning
Menu's current strong ETag, for example:

```http
If-Match: "menu-11111111-1111-4111-8111-111111111111-v7"
```

The token versions the whole aggregate. Item edits, including bulk/raw writes,
invalidate it through PostgreSQL triggers. Reorder may advance it several times;
clients must treat it as opaque. Version comparison happens after acquiring the
common transactional serialization guard. Two meaningful updates with the same
token cannot both commit: the loser returns `409 version_conflict`. Missing
`If-Match` returns `428`; malformed/weak/wildcard/stale tokens return `409`.
Reconcile the current tree rather than blindly retrying conflicts. Menu creation
needs no token because the resource does not yet exist. `Idempotency-Key` is not
supported on creates and is explicitly rejected; uncertain Menu creates can be
resolved by the unique Site/location and item creates by the changed Menu token.

Create a draft Menu:

```json
{"name":"Main navigation","location":"header"}
```

Create an item with the current Menu token; omitted sort_order appends to its
siblings. Parent null/omitted means a root item:

```json
{"label":"About","item_type":"custom","target":"/about"}
```

Reorder with the complete sibling UUID set, each UUID exactly once:

```json
{
  "parent": null,
  "items": [
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333"
  ]
}
```

Move an item under another item, at the zero-based destination sibling index:

```json
{"parent":"22222222-2222-4222-8222-222222222222","position":0}
```

Source and destination sibling positions change in one final-state UPDATE.
Sibling uniqueness is deferred only within the operation and rechecked before
returning. Cycles, foreign parents, and subtree depth above four are rejected;
failure rolls back all positions, versions and audit events. A root is level one.

Internal `page` UUID / `post` integer targets must exist in the Menu's Site.
Foreign references need `allow_cross_site=true` **and** a target-Site content-view
grant. A client flag never supplies permission. The target discriminant must
match the sole Page/Post reference, or an external HTTP(S) URL / normalized
custom same-Site path. Script/data schemes, credentials and encoded control or
redirect-smuggling input are rejected. No external URLs are fetched or followed.

## Errors and auditing

Responses use the standard envelope and `X-Request-ID` correlation header:

```json
{
  "error": {
    "code": "conflict",
    "message": "The request conflicts with the current resource state.",
    "details": {"reason":"version_conflict"}
  },
  "request_id":"1ea47c51-f2d7-402b-ad9a-4df619d03055"
}
```

| HTTP | Stable domain reason / meaning |
| --- | --- |
| 400 | `invalid_tree`, `invalid_target`, `invalid_order`, `invalid_menu`, `module_disabled`; field details where available. Serializer/JSON errors retain standard field errors. |
| 401 / 403 | Missing/invalid authentication or insufficient scoped permissions. |
| 404 | No resource in the requested Site/Menu boundary. |
| 409 | `version_conflict`, `duplicate_location`, `duplicate_order`, `children_present`, `concurrent_write`. |
| 428 | Current owning Menu `If-Match` is required. |
| 503 | Durable audit persistence failed; the entire mutation rolled back. |

Migration `cms.0010_menu_api_contract` adds server-managed versions, deferrable
sibling uniqueness, and shared audit triggers. Create/edit/delete, item move,
item reorder and Menu activation/deactivation use `audit_record_event`; explicit
sibling reorder also records `MENU_ITEMS_REORDERED` with a bounded order digest.
Snapshots carry Site/Menu identity and before/after fields, actor/system identity,
request ID and IP. Raw URL query strings/fragments and request bodies are omitted
from audit payloads. Row events preserve changed positions without unbounded
aggregate snapshots. An audit failure is fail-closed, including raw/model writes.

## Validation and completion evidence

Test results pending final execution. The focused suite covers CRUD, permission
separation, Site isolation, safe targets, actual simultaneous reorder requests,
rollback of invalid moves, audit consistency/failure, and OpenAPI contracts.

The earlier [model audit](menu-audit.md) is historical foundation evidence.
Changes remain uncommitted. A merged PR/commit, remote CI result and Azure DevOps
Issue attachment await owner review/publication; no Issue identifier was supplied.
