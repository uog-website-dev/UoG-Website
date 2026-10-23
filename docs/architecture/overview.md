# UoG Digital Platform — architecture overview (P0)

```
Browser
   |
   v
Nginx (:80)
   |
   +---- Next.js public-web  ( /         , :3000 )
   +---- Next.js admin-web   ( /admin/   , :3001 )
   +---- Django REST API     ( /api/ , /health/ , /django-admin/ )
              |
              +---- PostgreSQL 16 (one shared application database)
              +---- Redis (cache)  +  Redis (Celery broker)
              +---- Celery Worker / Celery Beat
              +---- MinIO (platform-public / -private / -documents)

Keycloak (:8080) ---- OIDC identity for both Next.js apps and API clients
```

## Core principles

1. **Single backend, shared database.** One Django project serves the whole
   platform. The future 35+ institutional websites are addressed by a
   configuration-driven, multi-site architecture: `Organization` and `Site`
   rows scope content in the *same* schema. Per-site databases, schemas or
   backend deployments are explicitly out of scope.

2. **Least-privilege database access.** Django migrations run as `uog_migrate`
   (schema owner); the web/worker processes run as `uog_app`
   (read/write-only). See `infrastructure/postgres/README.md`.

3. **Cache and broker are separate Redis instances.** The cache instance may
   evict (`allkeys-lru`); the broker instance is `noeviction` with AOF so
   queued Celery tasks are never silently dropped. Redis is never
   authoritative institutional storage.

4. **Identity is centralised in Keycloak** (realm `uog`). Both frontends use
   Auth.js (NextAuth v5) with confidential OIDC clients whose secrets are
   injected at startup by `keycloak-init` — no credentials in git.

5. **Everything is pinned.** Exact versions live in
   [version-matrix.md](./version-matrix.md); compose services never use
   floating `latest` tags.

## Key paths

| Concern | Location |
| --- | --- |
| Django settings (env-driven) | `backend/config/settings.py` |
| Django apps | `backend/apps/core` (platform core), `backend/apps/api` (sample API), `backend/apps/accounts` (identity), `backend/apps/audit` (shared audit), `backend/apps/organizations` (organizational structure) |
| Health endpoints | `backend/apps/core/views.py`, `docs/development/health.md` |
| Celery tasks & beat schedule | `backend/apps/core/tasks.py`, `backend/config/celery.py` |
| Frontend monorepo | `frontend/` (`apps/`, `packages/`) |
| Shared UI theme | `frontend/packages/ui` |
| Nginx routing | `infrastructure/nginx/conf.d/platform.conf` |
| Keycloak realm (no secrets) | `infrastructure/keycloak/realm-import/uog-realm.json` |
| Compose topology | `docker-compose.yml` |

## Extension points for later stories

* **Organizations/Sites:** Django app `backend/apps/organizations`
  (models, services, selectors, api, admin, migrations, tests). The
  foundation registers the domain; `OrganizationType` is a managed lookup
  with seeded classifications under [DEC-04](decisions/DEC-04-organization-types.md).
  `OrganizationUnit` now stores central institutional records under the
  [unit data-model choices](organization-unit-data-model.md).
  [Hierarchy operations](../development/organization-hierarchy.md) use recursive
  queries and a shared transactional guard with database cycle enforcement.
  [Lifecycle policy](organization-lifecycle-rules.md) protects the UNIVERSITY
  root and historical references and enforces forward-only retirement.
  Restricted [Organization REST APIs](../api/organizations.md),
  [hierarchy navigation](../api/organization-hierarchy.md),
  [search/filtering](../api/organization-discovery.md) and
  [shared transactional auditing](audit-contract.md) are implemented.
  The [readiness gate](../development/organization-readiness.md) records validation
  for Site backend development; production writes still await scoped IAM/RBAC.
  Site rows remain a subsequent story. Cache keys
  already route through `apps.core.cache.make_cache_key` for future
  org/site prefixes.
* **Media workflows:** store under key prefixes in the three platform
  buckets; never create per-site buckets.
* **RBAC:** Keycloak realm roles/groups plus DRF permission classes; the
  `backend-api` client already supports client-credentials flows.
