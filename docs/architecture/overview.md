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
| Django apps | `backend/apps/core` (platform core), `backend/apps/api` (sample API) |
| Health endpoints | `backend/apps/core/views.py`, `docs/development/health.md` |
| Celery tasks & beat schedule | `backend/apps/core/tasks.py`, `backend/config/celery.py` |
| Frontend monorepo | `frontend/` (`apps/`, `packages/`) |
| Shared UI theme | `frontend/packages/ui` |
| Nginx routing | `infrastructure/nginx/conf.d/platform.conf` |
| Keycloak realm (no secrets) | `infrastructure/keycloak/realm-import/uog-realm.json` |
| Compose topology | `docker-compose.yml` |

## Extension points for later stories

* **Organizations/Sites:** new Django app `backend/apps/organizations`
  (shared schema, FK-scoped rows); cache keys already route through
  `apps.core.cache.make_cache_key` for future org/site prefixes.
* **Media workflows:** store under key prefixes in the three platform
  buckets; never create per-site buckets.
* **RBAC:** Keycloak realm roles/groups plus DRF permission classes; the
  `backend-api` client already supports client-credentials flows.
