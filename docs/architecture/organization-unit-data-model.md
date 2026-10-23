# OrganizationUnit data-model choices

Implementation date: 2026-10-23 (Africa/Nairobi).

This records the entity story's decisions. The subsequent
[hierarchy implementation](../development/organization-hierarchy.md) now
provides the traversal and cycle protection deferred below.
The subsequent [lifecycle policy](organization-lifecycle-rules.md) adds
ARCHIVED, a protected ACTIVE UNIVERSITY root and archive-only retirement;
it supersedes this entity story's simpler status and deletion behavior.

The repository contains the approved Django skeleton and DEC-04, but no
separate P0 ERD or identifier specification was found. This implementation
uses the story's conceptual fields and the skeleton's existing BigAutoField
identifier convention. The choices below are implementation decisions
requested by this story, not a claim that a missing P0 ERD was reviewed.

## Fields and identifiers

| Field | Representation |
| --- | --- |
| id | BigAutoField primary key, matching existing domain models |
| code | Required canonical ASCII code, maximum 64 characters |
| name | Required human-readable text, maximum 255 characters |
| short_name | Optional text, maximum 100 characters, empty string when absent |
| organization_type | Required FK to the DEC-04 managed lookup; PROTECT |
| parent | Nullable self-FK, `children` reverse relation; PROTECT |
| description | Optional text, empty string when absent |
| status | Controlled ACTIVE / INACTIVE values, ACTIVE by default |
| metadata | Optional JSON object, independent empty-object default |
| created_at | Timezone-aware creation time, assigned automatically |
| updated_at | Timezone-aware modification time, updated by model saves |

There are no domain, homepage, theme or template fields. Sites and future
modules should reference the unit's primary key rather than duplicate its
institutional identity or infer its type from a translated name.

## Code normalization, uniqueness and immutability

Model validation normalizes `code` using `strip().upper()` before checking
fields and uniqueness. Stored codes begin with A–Z and contain only A–Z,
digits, underscores or hyphens. A database format check rejects
noncanonical SQL/bulk writes instead of silently normalizing them.

`organization_unit_code_uniq` is a database unique constraint on the stored
canonical code. Together with the format check, this enforces uniqueness
of normalized codes and provides an indexed exact-code lookup. There is
no redundant functional unique index. For example, model writes of ` cmhs `
and `CMHS` collide; raw SQL with ` cmhs ` fails the canonical-format check.

Code is immutable after insertion. Model validation and admin read-only
fields provide friendly checks, and a PostgreSQL trigger prevents changes
through queryset updates, bulk updates or raw SQL. Names, metadata and
status may change without changing the unit's identity. Case/whitespace
variants normalizing to the existing code remain the same identifier.

## Parent, roots and deletion

The institution may initially contain zero records; at most one record
may have `parent=NULL`. A PostgreSQL partial unique index on the constant
`1`, conditioned on null parent, makes root uniqueness concurrency-safe.
No initial University unit is fabricated or seeded. A second root must
instead be attached to the existing institutional structure.

The parent FK is nullable for the root and indexed automatically by Django.
Referenced parents and organization types use PROTECT; database FK
constraints remain enabled. No deletion cascades remove institutional
units. Root type restrictions, traversal, cycle detection and safe
reparenting belong to ORG-004/005. This entity story does not claim those
hierarchy behaviors are implemented.

## Status, metadata and timestamps

ACTIVE and INACTIVE are the minimal lifecycle states for this story.
Both field choices and a database check enforce the allowed values.
Inactive units remain referencable; module-specific access/activation
policies are separate concerns.

Metadata is PostgreSQL jsonb through Django JSONField, with an object-only
database check using `jsonb_typeof`. Lists, scalars, JSON null and SQL null
are rejected; empty objects are allowed. JSON serializability is checked
by Django. Do not use metadata to recreate Site configuration or bypass
typed organizational relationships. No metadata GIN index is added without
a defined query workload.

Model saves maintain timestamps, including `updated_at` on partial saves.
As with other Django auto_now fields, queryset updates and raw SQL must
set `updated_at` explicitly; no separate database timestamp trigger is added.

## Index choices and measurement

- BigAutoField primary-key index.
- Unique index on canonical code.
- Partial unique index enforcing at most one null-parent root.
- Automatic single-column FK indexes on parent and organization type.
- Composite `(status, code)` B-tree for status-filtered, code-ordered lists,
  matching the unit admin query pattern. No separate low-cardinality status
  index is added.

The status index was measured on PostgreSQL using a temporary table shaped
like OrganizationUnit: 100,000 synthetic rows, 99% ACTIVE and 1% INACTIVE,
with existing code/type/parent indexes. The measured query selects `id, code`
for INACTIVE units, orders by code and limits to 50 rows.

| Configuration | Median execution time, five runs | Query plan |
| --- | --- | --- |
| Without status/code index | 0.79 ms | Code index scan, 4,950 rows filtered out |
| With status/code index | 0.07 ms | Status/code index scan with status index condition |

These are local synthetic measurements, not production latency guarantees.
Small tables or different status distributions may lead PostgreSQL to choose
other plans. Remeasure against real workloads before adding more indexes.

Reproduce after migrating:

```console
docker compose exec backend python scripts/benchmark_organization_status.py
```

The benchmark creates data and indexes in a connection-local temporary
table, drops it on commit and never inserts institutional records.
