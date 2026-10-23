# Organization validation and lifecycle policy

Implementation date: 2026-10-23 (Africa/Nairobi).

No additional P0 lifecycle specification was found in this repository.
This policy implements the story's explicit forward lifecycle and root gate;
it does not claim that an unavailable P0 decision was reviewed.

## Lifecycle and root

| Current state | Allowed next state |
| --- | --- |
| New record | ACTIVE |
| ACTIVE | ACTIVE or INACTIVE |
| INACTIVE | INACTIVE or ARCHIVED |
| ARCHIVED | ARCHIVED |

Same-state saves are permitted subject to current domain checks. Skipping
deactivation, reactivation and unarchiving are rejected. There is no implicit
status change on a parent, child, Site or other record.

The database may be empty before institutional setup. Once created, its
single root must use the managed type code UNIVERSITY and remain ACTIVE.
UNIVERSITY cannot be used for non-root units. Root movement, type changes,
deactivation, archival and deletion are prohibited. The existing partial
unique index limits null-parent roots to one; a new local check requires
root status ACTIVE, and database triggers enforce the cross-table type rule.
The root's required name and presentation metadata may be corrected normally.

Code normalization/uniqueness, immutable codes, required names, valid type
and parent FKs, JSON-object metadata and cycle prevention retain their
previous server/database enforcement. Database unit IDs are also immutable,
preventing primary-key changes from bypassing root and history checks.

## Children and archived structure

Deactivating or archiving a unit requires **no ACTIVE descendants at any
depth**. Deactivate children from the leaves upward first. Archiving a parent
with INACTIVE or ARCHIVED descendants is allowed, retaining every row and
status unchanged. Those inactive descendants may subsequently be archived
explicitly, even when their parent is already archived.

An ACTIVE unit requires ACTIVE ancestors. New/reparented units cannot enter
an archived ancestor path. An archived unit's own parent and type are frozen;
its name, short name, description and metadata may receive corrections.
These rules preserve stable direct references; they are not a temporal
snapshot/versioning system for every historical ancestor path.

## Deletion and historical references

Destructive OrganizationUnit deletion is disabled for **all** units,
including currently unreferenced units. This deliberate conservative policy
avoids needing to guess whether external historical references exist.
Deactivate and archive instead. Admin hides deletion; model and service
deletion raise ValidationError; a BEFORE DELETE database trigger blocks
queryset and raw SQL deletion before database cascades can remove consumers.

Archival keeps the primary key, code, direct relationships and rows intact.
Ordinary references from users, content, analytics or other records do not
prevent archival. Historical references remain readable; organization
selectors do not silently filter archived records out. Referenced
OrganizationType records continue to use PROTECT.

## Linked Sites and the integration boundary

ACTIVE Sites linked anywhere in a unit's subtree veto both deactivation and
archival. INACTIVE or ARCHIVED Site links are retained and do not veto the
change. Sites must be deactivated explicitly in their own domain; organization
services do not cascade status changes or delete Site links.

There is **no Site model or Site API yet**. This implementation supplies and
tests the SQL integration hook `organizations_has_active_sites(bigint[])`.
It receives all relevant subtree IDs and must return whether any linked
Site is active. The default returns false while Sites is absent and fails
closed if the conventional `sites_site` table appears without integration.
That name check is a safeguard, not automatic integration for arbitrary
future Site table names or schemas.

When implementing Sites, its migration must:

1. Depend on `organizations.0005_lifecycle_rules` and replace the hook with
   a query using its actual approved table/status representation. Use the
   ID array in one EXISTS query; do not import Sites into organization models.
2. Serialize Site insertion, updates, linking, activation and deletion using
   `organizations_lock_hierarchy()`, acquiring the guard before unit locks.
   The existing statement trigger function `organizations_serialize_hierarchy`
   is reusable for this purpose.
3. Validate after guard acquisition that an ACTIVE Site references an ACTIVE
   unit. The existing organization rules ensure that such a unit's ancestors
   are active. FK constraints must remain enabled.
4. Validate existing Site data and test both sides of the race between a new
   active Site link and organization deactivation/archive.

Integration tests use a real FK consumer table and replacement hook in the
test database, including retained inactive references and active-Site vetoes.
They also exercise the guarded Site-write protocol on independent connections.
They do not introduce or certify a production Site module. Concrete Site
wiring remains part of implementing that domain.

## Enforcement and concurrency

`services.lifecycle` provides transition, deactivate and archive operations.
Each acquires the existing transactional hierarchy guard before fresh reads
and validation. Model saves enforce the same rules, including admin saves.
Database functions are the shared source of lifecycle validation, with a
domain adapter producing field-specific Django ValidationError messages.
A savepoint keeps a failed preflight from poisoning a surrounding transaction.

BEFORE ROW triggers repeat validation after the common BEFORE STATEMENT
guard, protecting bulk and raw SQL writes. The guard also serializes moves,
active-child creation and participating Site writes. A higher-isolation
serialization failure requires retrying the whole outer transaction; no
partial operation is silently retried. Authorization remains the caller's
responsibility and is not granted by these service functions.

Migration 0005 checks legacy records rather than rewriting them. Invalid
root types/statuses or inactive parents with active descendants prevent the
upgrade until deliberately corrected. Downgrading to the old two-status
schema cannot succeed while ARCHIVED rows exist; migration reversal does
not silently unarchive or erase them.
