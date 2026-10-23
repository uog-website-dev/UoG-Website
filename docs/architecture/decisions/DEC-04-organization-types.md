# DEC-04: Organization types are a managed lookup

Status: **Accepted** by the project owner in this implementation conversation
on 2026-10-23 (Africa/Nairobi).

## Decision

Represent institutional types as `organizations.OrganizationType` records,
not an enum or separate College/Department models. The database ID is the
relationship key; `code` is the stable machine-readable integration code.
Codes must begin with an uppercase ASCII letter, contain only uppercase
ASCII letters, digits or underscores, and be at most 64 characters long.
They are unique, cannot be blank, and cannot change after insertion.

Names are editable human-readable presentation data, not business identifiers.
Seed these ten initial records in a data migration:

| Code | Initial name |
| --- | --- |
| UNIVERSITY | University |
| COLLEGE | College |
| SCHOOL | School |
| INSTITUTE | Institute |
| DEPARTMENT | Department |
| RESEARCH_CENTER | Research Center |
| DIRECTORATE | Directorate |
| OFFICE | Office |
| ADMINISTRATIVE_UNIT | Administrative Unit |
| OTHER | Other |

Administrators may add codes and edit display names. Names need not be
unique. Do not hard-code this seed set as the complete set of valid types.
An OrganizationUnit must reference an existing lookup record.

## Enforcement and integration

Model validation provides readable errors for invalid codes, blank names,
duplicates and code changes. Database uniqueness/check constraints and a
PostgreSQL trigger also enforce code validity and immutability for bulk
updates and SQL clients. This follows the existing PostgreSQL architecture.

When OrganizationUnit is introduced, declare its type relation as:

```python
organization_type = models.ForeignKey(
    "organizations.OrganizationType",
    on_delete=models.PROTECT,
    related_name="organization_units",
)
```

Use `PROTECT`, with no cascade, set-null or implicit type creation. Keep
foreign-key constraints enabled. Referenced types cannot be deleted;
unreferenced types may be removed deliberately. This story does not create
OrganizationUnit or any unit-specific tables.

## Names and multilingual presentation

The lookup stores a default human-readable `name`. The initial English
labels are marked for Django translation extraction, and `display_name`
translates the stored label for the current presentation language where
a catalogue entry exists. Administrator-defined names fall back to their
stored text. Codes never change with locale. Additional locale catalogues
or a future managed translation system are presentation concerns; do not
add language-specific columns or branch domain behavior on translated names.
The repository currently has no locale catalogues or further multilingual
standard; this decision establishes the boundary without inventing translations.

## Migration behavior

`organizations.0001_initial` creates the lookup and database guards.
`organizations.0002_seed_organization_types` inserts missing initial types
without overwriting existing names. Reversing the seed migration retains
lookup rows, because they may have been edited or referenced. Reapplying it
is idempotent. Reversing the schema migration drops the lookup normally
after any dependent migrations have been reversed.
