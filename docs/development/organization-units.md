# OrganizationUnit implementation and evidence

This document records the entity story's scope and verification. Hierarchy
traversal and cycle-safe mutations are now implemented in the subsequent
[hierarchy story](organization-hierarchy.md), which adds migration 0004.

OrganizationUnit is the central institutional entity under
`apps.organizations.models.OrganizationUnit`. It references the managed
OrganizationType lookup and an optional parent unit. Database constraints,
code normalization/immutability, status, metadata, root uniqueness and
measured indexes are specified in the
[data-model decision](../architecture/organization-unit-data-model.md).

Administrators with Django model permissions can manage units at
`/django-admin/organizations/organizationunit/` through Nginx, or
`/admin/organizations/organizationunit/` directly on the backend. Existing
codes are read-only. Type and parent autocomplete fields use the existing
admin permission system.

Example model usage after migrations:

```python
from apps.organizations.models import OrganizationType, OrganizationUnit

university = OrganizationUnit.objects.create(
    code="UOG", name="University of Gondar",
    organization_type=OrganizationType.objects.get(code="UNIVERSITY"),
)
college = OrganizationUnit.objects.create(
    code="CMHS", name="College of Medicine and Health Sciences", short_name="CMHS",
    organization_type=OrganizationType.objects.get(code="COLLEGE"),
    parent=university, metadata={},
)
```

These examples create real rows; no units are seeded automatically.
Model saves call full_clean. Bulk writes must provide canonical codes and
valid data; database constraints still enforce integrity. Relation traversal
and cycle protection are deferred to ORG-004/005, as required by this story.

## Migration

`organizations.0003_organizationunit` follows the two existing type
migrations. It creates the entity, unique/check constraints, FK and status
indexes, the single-root partial index and a reversible code-immutability
trigger. No existing migration was rewritten for this story.

Use the existing entrypoint to apply schema changes with the migration role:

```console
docker compose exec backend /app/entrypoint.sh python manage.py check
docker compose exec backend python manage.py migrate --check
docker compose exec backend pytest
docker compose exec backend python manage.py makemigrations --check --dry-run
docker compose exec backend python manage.py spectacular --file /tmp/openapi.yaml --validate --fail-on-warn
```

## Completion evidence (2026-10-23)

| Evidence | Result |
| --- | --- |
| New model tests | **36 passed in 3.87s** against a freshly created PostgreSQL test database. |
| Full backend suite | **127 passed in 14.75s**, including existing type, identity, API, schema/documentation and infrastructure behavior checks. |
| Clean-database migration | pytest-django creates a fresh database and applies the migration chain; all model/integrity tests passed against it. |
| Development migration | `organizations.0003_organizationunit` applied successfully as `uog_migrate`; `showmigrations` marks all three organization migrations applied. |
| Migration drift | `makemigrations --check --dry-run`: **No changes detected**; `migrate --check`: exit 0. |
| Database integrity | Failed duplicate-code bulk insert verified; invalid normalized codes, invalid status/metadata, multiple roots, immutable-code changes and missing type/parent FK references fail at the database layer. |
| Indexes | PostgreSQL introspection verifies parent/type indexes, code/root uniqueness and `(status, code)` index. Measured status-query results are in the data-model decision. |
| Startup | Django system check: **no issues**; live readiness endpoint: **HTTP 200**. |
| API/schema | No OrganizationUnit REST API added in this entity story. Existing OpenAPI schema still validates with warnings treated as failures (exit 0). |
| Hosted CI | **Pending**. Existing Azure pytest step discovers these tests; no hosted pipeline result has been verified for this working tree. |
| Merged story PR/commit | **Pending**; attach the actual merged reference before closing the story. |

No regression was detected by the complete backend suite and application
readiness check. Website-specific data, hierarchy traversal/cycle protection
and new REST operations remain outside this implementation.
