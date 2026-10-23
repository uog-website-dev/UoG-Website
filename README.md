# University of Gondar — Digital Platform

Standardized full-stack development foundation for the University of Gondar
Digital Platform: **one Django backend**, **one shared PostgreSQL database**,
**two Next.js applications**, and common platform services (Redis/Celery,
MinIO, Keycloak, Nginx) — all runnable with a single command.

```
Browser -> Nginx -> Next.js public-web  ( /       )
                 -> Next.js admin-web   ( /admin/ )
                 -> Django REST API     ( /api/ , /health/ )
                       -> PostgreSQL | Redis cache | Redis broker
                       -> Celery Worker / Beat | MinIO
Keycloak (:8080) ---- OIDC identity for both frontends and API clients
```

## Quick start

```bash
git clone <repository-url> uog-digital-platform
cd uog-digital-platform
cp .env.example .env     # development defaults work immediately
docker compose up -d --build
```

Verify:

```bash
docker compose ps                 # all services healthy
bash scripts/smoke-test.sh        # automated end-to-end smoke tests
```

First start automatically provisions everything (no manual steps):
database roles and migrations, MinIO buckets, the Keycloak `uog` realm with
its OIDC clients, and the Celery beat schedule.

## Access points

| Service | URL |
| --- | --- |
| Public website | http://localhost |
| Admin console | http://localhost/admin |
| Django REST API | http://localhost/api/ |
| Backend health | http://localhost/health/ready |
| Django admin | http://localhost/django-admin/ |
| Keycloak | http://localhost:8080 (realm `uog`) |
| MinIO console | http://localhost:9001 |
| Direct ports | backend :8000, public-web :3000, admin-web :3001 |

## Testing credentials

All values below are the **development defaults** from `.env.example`;
`cp .env.example .env` gives you exactly these. `.env` is gitignored —
change every password before any shared or production-like deployment.

| Where to log in | URL | Username | Password (dev default) |
| --- | --- | --- | --- |
| Public website & Admin console ("Sign in" button, Keycloak realm `uog`) | http://localhost · http://localhost/admin | `devuser` | `DevUser!2026` |
| Keycloak admin console (realm `uog`) | http://localhost:8080 | `uog_admin` | `keycloak_admin_dev_password` |
| MinIO console | http://localhost:9001 | `uog_minio_admin` | `minio_dev_secret_change_me` |
| Django admin | http://localhost/django-admin/ | *create once, see below* | *create once, see below* |

Notes:

* `devuser` (email `devuser@uog.et`) is created automatically at first
  start by `keycloak-init` — credentials come from `.env` →
  `KEYCLOAK_DEV_USERNAME` / `KEYCLOAK_DEV_PASSWORD`.
* The Django admin intentionally ships **no default account** (no secrets
  in source control). Create a development superuser once:

  ```bash
  docker compose exec backend python manage.py createsuperuser
  ```

  or non-interactively with a throwaway password:

  ```bash
  docker compose exec \
    -e DJANGO_SUPERUSER_USERNAME=admin \
    -e DJANGO_SUPERUSER_PASSWORD=admin \
    backend python manage.py createsuperuser --noinput
  ```

* To test API token issuance manually (same grant the smoke tests use):

  ```bash
  curl -X POST http://localhost:8080/realms/uog/protocol/openid-connect/token \
    -d grant_type=client_credentials \
    -d client_id=backend-api \
    -d client_secret=backend-api-dev-secret
  ```

## Common commands

| Task | Command |
| --- | --- |
| Start / stop | `docker compose up -d` / `docker compose stop` |
| Rebuild containers | `docker compose up -d --build` |
| Logs | `docker compose logs -f [service]` |
| Run migrations | `docker compose exec backend python manage.py migrate` |
| Backend tests | `docker compose exec backend pytest` |
| Frontend tests | `cd frontend && pnpm test` |
| Frontend builds (Turborepo) | `cd frontend && pnpm build` |
| Health check | `bash scripts/smoke-test.sh` |
| Submit test Celery task | `docker compose exec backend celery -A config call core.ping --args '["hello"]'` |
| Reset local data (destructive) | `docker compose down -v` |

Full setup, troubleshooting and workflow details:
[docs/development/setup.md](docs/development/setup.md).

## Project structure

```
uog-digital-platform/
├── backend/                 # Django 5.1 + DRF (Python 3.12)
│   ├── config/              # settings, urls, celery
│   ├── apps/                # core (health/tasks/storage), api (sample API)
│   ├── requirements/        # pinned base/dev/prod layers
│   ├── tests/               # pytest suite
│   ├── manage.py
│   ├── entrypoint.sh        # migration-role execution, then app start
│   └── Dockerfile
├── frontend/                # pnpm 9 workspace + Turborepo 2
│   ├── apps/
│   │   ├── public-web/      # Next.js 15 public site (Auth.js + MUI)
│   │   └── admin-web/       # Next.js 15 admin console (/admin)
│   ├── packages/
│   │   ├── ui/              # shared UoG Material UI theme + shell
│   │   ├── api-client/      # typed fetch client
│   │   ├── types/           # shared TypeScript types
│   │   └── config/          # shared tsconfig presets
│   ├── package.json / pnpm-workspace.yaml / pnpm-lock.yaml / turbo.json
│   └── Dockerfile
├── infrastructure/
│   ├── nginx/               # reverse-proxy configuration
│   ├── keycloak/            # realm import (no secrets) + bootstrap script
│   ├── postgres/            # role bootstrap (migration vs runtime)
│   ├── minio/               # bucket documentation
│   └── redis/               # cache vs broker configs
├── docs/
│   ├── architecture/        # overview + reconciled version matrix
│   └── development/         # setup guide + health endpoint reference
├── scripts/smoke-test.sh    # automated startup verification
├── docker-compose.yml
├── .env.example
└── README.md
```

## Architecture decisions (summary)

* **One shared database and schema** for all future institutional sites —
  multi-tenancy via `Organization`/`Site` row scoping, never per-site
  databases.
* **Separated DB privileges**: migrations run as `uog_migrate` (schema
  owner); the app runs as `uog_app` (data access only, never a superuser).
* **Two Redis instances**: evicting cache vs `noeviction`+AOF broker, so
  cache pressure can never drop queued tasks.
* **MinIO buckets are platform-level** (`platform-public`,
  `platform-private`, `platform-documents`) — never one per site.
* **Keycloak realm is version-controlled**; secrets are injected from `.env`
  at startup and are never committed.
* **The Django API is an OIDC resource server**: protected endpoints accept
  the Keycloak access tokens the frontends obtain at sign-in (validated
  against the realm JWKS — signature, issuer, audience, expiry). The tokens
  stay server-side in the Auth.js session cookie; anonymous requests get
  `401`.
* **All versions pinned** — see
  [docs/architecture/version-matrix.md](docs/architecture/version-matrix.md).

## Further reading

* [Architecture overview](docs/architecture/overview.md)
* [Version matrix](docs/architecture/version-matrix.md)
* [Development guide & troubleshooting](docs/development/setup.md)
* [Health endpoints](docs/development/health.md)
