# Organization hierarchy

The subsequent [lifecycle rules](organization-lifecycle.md) add root and
status restrictions to the structural moves described here. They reuse the
same transactional guard and now prohibit all destructive unit deletion.

The hierarchy uses the existing OrganizationUnit adjacency list (`parent_id`)
with PostgreSQL recursive queries. No tree library, path column, closure
table, Organization API or additional business entity is introduced.
The existing single-root policy and protected parent/type references remain.

## Reading structure

```python
from apps.organizations.selectors.hierarchy import (
    get_parent, get_children, get_ancestors,
    get_descendants, get_subtree, get_root,
)

parent = get_parent(unit_id)                    # None for root
children = get_children(unit_id)               # lazy queryset, ordered by code
ancestors = get_ancestors(unit_id)              # root first; excludes self
path = get_ancestors(unit_id, include_self=True)
descendants = get_descendants(unit_id)          # breadth-first; excludes self
subtree = get_subtree(unit_id)                  # includes self
root = get_root(unit_id)
```

Descendants are returned in breadth-first order: increasing depth, then code.
Ancestors, descendants, subtree and root each execute one SQL query with
`WITH RECURSIVE`; no per-node ORM query loop is used. The existing parent FK
index supports child expansion. Result size is proportional to the requested
subtree or path. These functions return model lists; children is a queryset.
Missing IDs raise OrganizationUnit.DoesNotExist, except children, which
returns an empty queryset. Root ancestors and leaf descendants are empty.

Structural selectors include active and inactive units and do not grant
authorization. Future authorization and analytics code can consume IDs and
relationships, but must apply its own permission and visibility rules.
No institutional-type-specific parenting restrictions are invented here.
If a future write authorization depends on ancestry, acquire
`hierarchy_write()` before that authorization check and invoke the move in
the same guarded transaction, so a concurrent move cannot invalidate the
permission decision.

## Changing structure

```python
from apps.organizations.services.hierarchy import move_unit

moved = move_unit(unit_id, parent_id=new_parent_id)
```

The service acquires the common hierarchy guard before fetching current
state and validating the new parent. It returns the saved model and updates
its modification timestamp. Self-parenting, descendant-parenting, missing
parents and a second root are rejected. Parent/type deletion remains protected.
An existing University root may have College, Research Center and Directorate
children; Departments may be below Colleges. Types remain managed lookup
records rather than separate entity tables.

Model saves and deletes use the same guard. This covers admin form saves;
an earlier form/full_clean check is only a preflight, and save revalidates
after acquiring the guard. Direct parent assignment remains supported:
`unit.parent = parent; unit.save()`.

Group multiple operations in an outer `transaction.atomic()` when they must
all commit together. The guard remains held until that outer transaction
ends, and a rollback restores previous relationships. Acquire the guard
before any explicit unit-row locks; the supplied service already does so.

## Concurrency and database enforcement

`organizations.0004_hierarchy_integrity` adds:

1. An internal singleton `organizations_hierarchy_guard` table, initialized
   by migration, and `organizations_lock_hierarchy()`.
2. A BEFORE STATEMENT trigger for every unit INSERT/UPDATE/DELETE. It updates
   the guard row before unit-row changes, covering queryset, bulk and direct
   SQL writes as well as the application service.
3. A VOLATILE AFTER ROW trigger for insertion and parent updates. After the
   guard is acquired it follows the candidate parent's ancestry and rejects
   a path back to the changed unit. Recursive UNION prevents the validation
   query itself looping on malformed input.
4. An explicit database self-parent check constraint.

All hierarchy writers contend on one transactional row, which is appropriate
for relatively infrequent institutional structure changes. Even non-parent
unit updates serialize, keeping the mechanism simple. Ordinary reads do not
take this write guard and see a consistent SQL statement snapshot.

The guard is updated rather than merely locked. At READ COMMITTED, a waiting
writer validates the winner's committed relationships. At REPEATABLE READ
or SERIALIZABLE, an outdated guard row produces a serialization failure
instead of allowing validation against an old snapshot. PostgreSQL functions
are explicitly VOLATILE so their internal queries use current command
visibility. The database mechanism enforces structure even when model
validation is bypassed.

The service does not swallow validation/database errors or silently retry a
partial business operation. A caller handling SQLSTATE `40001` must retry the
whole outer transaction using fresh reads; normal cycle failures are not
retryable as the same operation. Runtime SQL still needs its normal explicit
timestamp handling. The guard is internal infrastructure, not an editable
business record; if it is absent, mutations fail closed.

The migration locks out writers during installation and checks existing
parent links for cycles before enabling the new guards. It fails if legacy
cycles exist and does not silently modify institutional records. Correct
those records deliberately before retrying. The migration can be reversed;
the previous three organization migrations are unchanged. Deploy this
migration before sending writes through the new application code.

PostgreSQL references: [transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html),
[trigger timing and rollback](https://www.postgresql.org/docs/16/trigger-definition.html),
and [VOLATILE function visibility](https://www.postgresql.org/docs/16/xfunc-volatility.html).

## Verification and completion evidence

```console
docker compose exec backend pytest apps/organizations/tests/test_hierarchy.py
docker compose exec backend pytest
docker compose exec backend /app/entrypoint.sh python manage.py check
docker compose exec backend python manage.py migrate --check
docker compose exec backend python manage.py makemigrations --check --dry-run
docker compose exec backend python manage.py spectacular --file /tmp/openapi.yaml --validate --fail-on-warn
```

Tests cover University → College → Department, research centers/directorates,
all traversal operations, deterministic ordering, one-query traversal,
valid subtree moves, rollback, self/descendant cycles, root uniqueness,
missing parents, bulk/direct SQL cycles, missing guard failure, and migration
reversal/reapplication with rejection of invalid legacy data.

Six simultaneous-inverse-move tests use independent PostgreSQL connections
and a barrier, after both have read their initial state. They exercise both
the service and raw SQL at READ COMMITTED, REPEATABLE READ and SERIALIZABLE.
Exactly one inverse move commits; the other is rejected, without timeouts or
deadlocks being accepted as a passing result. The resulting graph remains
acyclic and both units still resolve to the University root.

### Completion evidence (2026-10-23)

| Evidence | Result |
| --- | --- |
| Migration | `organizations.0004_hierarchy_integrity` applied successfully in Docker as `uog_migrate`; all four organization migrations marked applied. |
| Hierarchy suite | **22 passed in 7.11s** against PostgreSQL, including six simultaneous inverse-move cases and migration reversal/reapplication. |
| Full regression suite | **149 passed in 22.11s**, covering previous organization/type, platform, API, identity and OpenAPI documentation stories. |
| Concurrent READ COMMITTED | One move commits; the other raises service validation or SQLSTATE 23514 from database cycle enforcement. |
| Concurrent higher isolation | One move commits; the other raises SQLSTATE 40001. Deadlocks, lock timeouts and unrelated errors are not accepted test outcomes. |
| Migration/model consistency | `makemigrations --check --dry-run`: **No changes detected**; `migrate --check`: exit 0. |
| Startup | Django system check: **no issues**; live liveness, readiness and Swagger: **HTTP 200**. |
| Runtime role | `uog_app` successfully acquires the guard, creates/saves/moves units, traverses the tree and rejects direct SQL self-parenting; verification records were fully rolled back. |
| Schema/API | No REST operations added; existing OpenAPI generation/validation with warnings treated as failures passes (exit 0). |
| Hosted CI | **Pending**. The existing Azure pytest step discovers the hierarchy tests, but no hosted run result has been verified for these working-tree changes. |
| Merged PR/commit | **Pending**; attach the actual merged story reference before closing the story. |

No regression was detected by the complete backend suite and live startup/
documentation checks. The hierarchy provides structural operations and
integrity; authorization policy, analytics endpoints and organizational REST
APIs remain separate stories.
