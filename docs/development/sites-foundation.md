# P1-SITE-001: digital Site module foundation

Implementation date: 2026-10-24 (Africa/Nairobi).

This is the historical SITE-001 foundation record. The subsequent
[SITE-002 entity story](site-entity.md) adds the actual Site table and wired
Organization lifecycle hook; the no-model/no-table statements below describe
the initial foundation, not the current entity implementation.

`apps.sites` is the dedicated domain for digital properties. It is registered
with Django as label `sites` / “Digital Sites”, independently of the
institutional `apps.organizations` domain. It uses the existing Django
project, shared database, BigAutoField default and backend test/CI machinery.
It does not install Django's separate `django.contrib.sites` framework.

```text
backend/apps/sites/
├── __init__.py
├── apps.py
├── models/__init__.py
├── services/__init__.py
├── selectors/__init__.py
├── api/
│   ├── __init__.py
│   └── urls.py
├── admin/__init__.py
├── migrations/__init__.py
└── tests/
    ├── __init__.py
    └── test_module.py
```

The package layout follows the existing Organization backend skeleton:
models for persistence, services for mutations, selectors for reads, api
for transport/serializers, admin for registrations, migrations and tests.
There are no speculative business model files, database tables, serializers,
public endpoints or permission bypasses in this story.

## Domain ownership and dependency direction

An **OrganizationUnit** represents an institutional structure. A **Site**
represents a digital property owned by/referencing an institutional unit.
An organization can exist without a website. Registering this app does not
create a website for any organization or modify the organizational hierarchy.

| Domain | Responsibility |
| --- | --- |
| Organizations | Institutional identity/code, type, parent/hierarchy, organizational lifecycle |
| Sites | Digital property; eventually Site, SiteDomain, SiteConfiguration, SiteTemplate, Module and SiteModule |
| Shared platform | Verified identity/permissions, database and request IDs, durable common audit writer, storage/cache and CI |

SiteDomain (host mapping), SiteConfiguration, SiteTemplate and module
activation concepts will remain clearly scoped parts of the Site domain.
Their concrete model/service/selector/API files should arrive with the
corresponding entity stories; none are declared by this foundation. Do not
create parallel University/College/Department models inside Sites or put
domain/homepage/theme/template fields onto OrganizationUnit.

The eventual Site-to-organization reference should target the existing
`organizations.OrganizationUnit` using a lazy model relationship and an
explicit migration dependency, with approved cardinality/protection from
the entity story. No reverse import from Organizations into Site business
models or automatic Site-creation signal is introduced. The foundation has
no direct model imports between these domains; package imports and boundary
tests guard against accidental circular dependencies.

## Migration and lifecycle integration boundary

`migrations/__init__.py` initializes the package. There is no `0001_initial`
yet because this story declares no Site schema. All existing platform,
Organization and Audit migrations remain authoritative and unchanged.
No Site table means the existing Organization absent-Sites lifecycle hook
continues to operate normally; tests verify this explicitly.

When the first real Site table is implemented, its migration must depend
on the latest Organization contract (`organizations.0006_audit_events`,
which includes the lifecycle/audit prerequisites) and wire
`organizations_has_active_sites(bigint[])` to the actual Site representation
in the same schema migration. Site writes must use the shared hierarchy
serialization guard, validate active ownership, preserve historical
references and use the shared audit contract. Do not introduce a table
named `sites_site` while leaving the absent-Sites stub unwired; it is designed
to fail closed. Other table names require the same explicit integration.

See [Organization readiness](organization-readiness.md),
[lifecycle integration](../architecture/organization-lifecycle-rules.md) and
[shared auditing](../architecture/audit-contract.md). This foundation does
not claim that Site lifecycle/RBAC integration is already implemented.

## API and automated checks

The foundation registered namespace `sites` at `/api/v1/sites/` with an empty
URL list, so that prefix returned 404 and added no OpenAPI operations.
Current administration is the [Site API contract](../api/sites.md). It reuses
the approved authentication, error, and request-ID conventions. Writes stay
behind the development opt-in until scoped authorization exists.

Tests are collected by the existing pytest configuration and existing
backend CI job. No new project, infrastructure, CI pipeline or database is
created by this story. The focused suite checks module imports/startup,
model separation, domain import direction, reserved routing, migration
compatibility, lifecycle-hook compatibility and existing platform routes.

```console
docker compose exec -T backend pytest -o addopts='' -q apps/sites/tests
docker compose exec -T backend pytest --create-db -o addopts='' -q
docker compose exec -T backend python manage.py check
docker compose exec -T backend python manage.py makemigrations --check --dry-run
docker compose exec -T backend python manage.py migrate --check
docker compose exec -T -e DEBUG=False backend python manage.py spectacular --file /tmp/sites-foundation-openapi.yaml --validate --fail-on-warn
```

The OpenAPI repository snapshot is [docs/api/openapi.yaml](../api/openapi.yaml),
also available live at `/api/schema/`, `/api/docs/` and `/api/redoc/` under
the existing documentation policy. No Site schema/API reference is invented
for entities not yet implemented. Hosted CI result and a merged PR/commit
remain pending until the user reviews/pushes/merges this working-tree change.

## Story completion evidence (2026-10-24)

| Evidence | Result |
| --- | --- |
| Application/package foundation | `apps.sites` registered; models/services/selectors/api/admin/migrations/tests packages import successfully. |
| Focused tests | **7 passed in 6.05s** for module startup, separation, namespace, migration/lifecycle compatibility and existing routes. |
| Clean PostgreSQL regression suite | **324 passed in 116.00s** (`pytest --create-db -o addopts='' -q --junitxml=/tmp/sites-foundation-results.xml`). Includes all 317 prior tests and seven Site foundation checks; [JUnit output](evidence/sites-foundation.junit.xml). |
| Database/migrations | `check`, `makemigrations --check --dry-run`, `migrate --check`: exit 0. No schema migration required; `migrations/__init__.py` is initialized. Existing Organization `0006_audit_events` and Audit `0002_common_writer` remain applied; no `sites_site` table exists. |
| Schema/API | `spectacular --validate --fail-on-warn` with DEBUG=False: exit 0. Generated schema equals the updated snapshot, still 20 operations across 14 paths. Sites tag describes the foundation; no Site operation is exposed. |
| Running backend | `/health/live` and `/health/ready` return 200; `/api/v1/sites/` returns 404; anonymous `/api/v1/organizations/` remains 401. |
| Domain boundary | No duplicated Organization models, reverse domain imports, business entity placeholders or automatic Site creation. Organization lifecycle's absent-Sites hook still returns false. |
| Regression | No regression detected in local automated checks. Existing authentication, Organization hierarchy/lifecycle/discovery/audit and docs tests all pass. |
| Source / PR / CI | Working tree on `P1-SITE-001-to-P1-SITE-010`, baseline `b58bd16` (existing Organization merge, not a Site implementation commit). No commit/push/merge performed. Hosted CI result and merged Site PR/commit remain pending; existing CI automatically collects Site tests through pytest.ini. |
