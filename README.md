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
| Swagger UI | http://localhost/api/docs/ |
| OpenAPI schema | http://localhost/api/schema/ |
| ReDoc | http://localhost/api/redoc/ |
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

## Swagger and authenticated API testing

Open [Swagger UI](http://localhost/api/docs/) to explore the live CMS,
Identity and Organizations endpoints. Swagger and ReDoc use self-hosted assets.

Run `python scripts/dev-api-token.py` from the repository root. Enter your
local Keycloak development client secret and user credentials, then copy
the short-lived access token into **Authorize → keycloakBearer** (JWT only,
without `Bearer`). Try `GET /api/me/`; the admin overview also requires the
`platform-admin` role. Backend permissions remain enforced. Tokens are not
persisted across Swagger reloads.

Production documentation is disabled by default (`API_DOCS_ENABLED=False`).
If explicitly enabled with `DEBUG=False`, all documentation views require
an active staff identity. Organization APIs are at `/api/v1/organizations/`;
all operations require a verified `platform-admin` bearer token. Writes
additionally require `DEBUG=True` and `ORGANIZATIONS_DEV_WRITES_ENABLED=True`
(default False); production writes remain disabled pending scoped IAM/RBAC.
PATCH and lifecycle actions require the current detail ETag in `If-Match`.
See the [Organization API contract](docs/api/organizations.md),
[hierarchy navigation and limits](docs/api/organization-hierarchy.md),
[search/filtering and ordering](docs/api/organization-discovery.md),
[transactional auditing](docs/api/organization-audit.md),
[error catalog](docs/api/error-catalog.md), and [OpenAPI snapshot](docs/api/openapi.yaml).
Site and Domain APIs remain unimplemented.

Generate and validate the same schema used by CI:

```bash
docker compose exec backend python manage.py spectacular --file /tmp/openapi.yaml --validate --fail-on-warn
```

See [API documentation instructions](docs/development/api-documentation.md)
for authentication, errors, request IDs, scope/activation requirements,
production access, and extending the generated schema. Handled DRF errors
now use `{error: {code, message, details}, request_id}`; clients should read
field errors from `error.details`.

## Organization types

Organization types are a managed lookup under
[DEC-04](docs/architecture/decisions/DEC-04-organization-types.md), seeded with
the ten UoG institutional classifications. Administrators can manage names
and add types in Django admin; existing codes are immutable. See
[organization type instructions](docs/development/organization-types.md)
for migrations, validation, translation labels, and protected references.

`OrganizationUnit` now stores institutional records, with a protected type
and parent relationship, one optional root, immutable normalized codes,
ACTIVE/INACTIVE/ARCHIVED status and object-only metadata. See
[unit implementation and evidence](docs/development/organization-units.md)
for model usage, migration and database/index verification.
[Hierarchy operations](docs/development/organization-hierarchy.md) now provide
parent, children, ancestors, descendants/subtree and root queries, with
serialized cycle-safe moves and database enforcement. Site-specific
configuration remains in the future Site domain; the Organization REST,
hierarchy, discovery and audit contracts are linked above.

[Lifecycle rules](docs/development/organization-lifecycle.md) enforce
ACTIVE → INACTIVE → ARCHIVED, an immovable ACTIVE UNIVERSITY root,
bottom-up deactivation, retained historical references and archive-only
retirement. Active linked Sites veto retirement through a tested integration
hook; the future Site domain must wire that hook and the shared write guard.

See the [Organization backend readiness gate](docs/development/organization-readiness.md)
for the representative UoG acceptance workflow, reproducible validation,
remaining Site/RBAC dependencies and completion evidence.

## Common commands

| Task | Command |
| --- | --- |
| Start / stop | `docker compose up -d` / `docker compose stop` |
| Rebuild containers | `docker compose up -d --build` |
| Logs | `docker compose logs -f [service]` |
| Run migrations (migration role) | `docker compose exec backend /app/entrypoint.sh python manage.py check` |
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
│   ├── apps/                # core, api, accounts, organizations
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
