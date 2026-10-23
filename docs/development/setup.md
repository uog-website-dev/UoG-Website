# Development guide

## Prerequisites

* Docker Engine + Docker Compose v2
* Git
* (Optional, for running frontend tooling directly on the host) Node 22+
  with `corepack enable` (pnpm 9 is pinned via `packageManager`)

## First run

```bash
git clone <repository-url> uog-digital-platform
cd uog-digital-platform
cp .env.example .env      # dev defaults work out of the box
docker compose up -d --build
```

On first start, automatically:

1. PostgreSQL initialises the shared database and the `uog_migrate` /
   `uog_app` roles (`infrastructure/postgres/init/`).
2. `minio-init` creates the three approved MinIO buckets.
3. The backend applies committed migrations **as the migration role**.
4. Keycloak imports the `uog` realm from
   `infrastructure/keycloak/realm-import/uog-realm.json`; `keycloak-init`
   then injects OIDC client secrets from `.env`, creates the dev user and
   smoke-tests token issuance.
5. Celery worker + beat connect to the broker Redis; beat emits a heartbeat
   task every minute.

Check everything is healthy:

```bash
docker compose ps
bash scripts/smoke-test.sh
```

## Day-to-day commands

| Task                        |                          Command                                                  |
| -------------------- -------| ----------------------------------------------------------------------------------|
| Start services              | `docker compose up -d`                                                            |
| Rebuild after image changes | `docker compose up -d --build`                                                    |
| Stop services               | `docker compose stop`                                                             |
| Stop and remove containers  | `docker compose down`                                                             |
| Follow logs (all)           | `docker compose logs -f`                                                          |
| Follow logs (one service)   | `docker compose logs -f backend`                                                  |
| Run migrations              | `docker compose exec backend python manage.py migrate`                            |
| Make migrations             | `docker compose exec backend python manage.py makemigrations`                     | 
| Django shell                | `docker compose exec backend python manage.py shell`                              |
| Backend tests (pytest)      | `docker compose exec backend pytest`                                              |
| Frontend tests              | `cd frontend && pnpm test`                                                        |
| Frontend builds             | `cd frontend && pnpm build`                                                       |
| Frontend typecheck          | `cd frontend && pnpm typecheck`                                                   |
| Create superuser            | `docker compose exec backend python manage.py createsuperuser`                    |
| Submit a Celery task        | `docker compose exec backend celery -A config call core.ping --args '["hello"]'`  |
| Re-run storage bootstrap    | `docker compose exec backend python manage.py init_storage`                       |
| Reset **all** local data    | `docker compose down -v` (see warning below)                                      |
| Reset only database data    | `docker compose down && docker volume rm uog-digital-platform_postgres_data`      |

> **Warning:** `docker compose down -v` deletes all named volumes
> (databases, MinIO objects, Redis data). It is safe for development but
> destroys local state.

## Ingress policy

The development nginx ingress enforces a strict host-based admission policy:

* **Known hosts** (`localhost`, `127.0.0.1`) — requests on these hosts are
  processed through the full routing stack (frontends, backend API, health
  checks, Auth.js endpoints). This matches the `if ($host !~ ^(localhost|127\\.0\\.0\\.1)$ ) { return 444; }`
  directive in `infrastructure/nginx/nginx.conf`.
* **Unknown hosts** — any request arriving on a host other than the known
  set receives HTTP 444 (connection dropped) and is immediately terminated.
  This prevents accidental exposure of internal services and ensures that only
  explicitly allowed development origins reach the platform.
* **TLS termination** — in development, nginx runs over plain HTTP on port 80.
  No TLS is terminated at the ingress; HTTPS is only used when running against
  a production environment (Sites, custom domains, etc.).
* **Route exposure** — all platform routes (`/`, `/admin/`, `/api/`, `/health/`,
  `/api/auth/`, `/django-admin/`) are only reached after the host check passes.

See `infrastructure/nginx/conf.d/platform.conf` for the full routing table
and host-to-service mappings, and `infrastructure/nginx/nginx.conf` for the
security headers and host-rejection directive.

## Frontend development notes

* The two apps share one pnpm workspace (`frontend/`) — packages:
  `@uog/ui` (theme + shell components), `@uog/api-client` (typed fetch),
  `@uog/types` (shared types), `@uog/config` (tsconfig presets).
* Containers run `pnpm dev` (Turborepo) with source bind-mounted for hot
  reload; `node_modules` live in named volumes and are reconciled with the
  committed lockfile on every start.
* Prefer editing shared things in `packages/`; app-specific code in `apps/`.

## Single sign-on (Keycloak)

Both frontends use Auth.js v5 against the Keycloak realm `uog`. Keycloak runs
with a **frontend hostname** and a **dynamic backchannel**:

* `KC_HOSTNAME=http://localhost:8080` — the issuer Keycloak advertises in the
  discovery document, in the authorization response and in the `iss` claim of
  the tokens. The browser has to be able to reach it, so it is the published
  host port, not the Docker service name.
* `KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true` — the token/userinfo endpoints
  answer on whichever host the request arrives on, so the Next.js processes
  can use `http://keycloak:8080` on the Docker network.

The frontends therefore get three different URLs (see `docker-compose.yml`):

| Variable | Value | Used by |
| --- | --- | --- |
| `KEYCLOAK_ISSUER` | `http://localhost:8080/realms/uog` | Auth.js — the issuer every `iss` claim is compared against |
| `KEYCLOAK_AUTH_URL` | `http://localhost:8080/realms/uog/protocol/openid-connect/auth` | The browser (authorization redirect) |
| `KEYCLOAK_TOKEN_URL` | `http://keycloak:8080/realms/uog/protocol/openid-connect/token` | The Next.js process (code exchange) |
| `KEYCLOAK_USERINFO_URL` | `http://keycloak:8080/realms/uog/protocol/openid-connect/userinfo` | The Next.js process (profile) |

Because the token and userinfo endpoints are configured explicitly, Auth.js
skips the OIDC discovery request and never compares a discovery document
issued for the internal host with the public issuer — the classic
`"response" body "issuer" property does not match the expected value`
failure in a split-host setup.

The admin console is served under the Next.js base path `/admin`, so its
Auth.js endpoints live at `/admin/api/auth/*` and its OAuth redirect URI is
`http://localhost/admin/api/auth/callback/keycloak` (registered in the realm
as `http://localhost/admin/api/auth/*`). The public site uses
`http://localhost/api/auth/*`.

### API authentication (access tokens)

The Django API is an OIDC **resource server**: it does not run the OAuth
dance, it validates the Keycloak access tokens the frontends obtained at
sign-in (see `backend/apps/accounts/`):

* `GET /api/me/` — the identity behind the presented token (401 without one).
* `GET /api/admin/overview/` — requires the `platform-admin` realm role.
* `GET/POST /api/pages/` — published pages are public; writing requires a
  token.

The tokens are kept **server-side**: Auth.js stores them in the httpOnly,
encrypted session cookie (never in the browser-visible session object), and
server components/actions read them with `getToken` (`next-auth/jwt`) when
they call the API with `Authorization: Bearer …` (see
`apps/admin-web/src/access-token.ts`). Keycloak access tokens live 5 minutes;
an expired one is refreshed with the session's refresh token, best effort —
a failed refresh simply yields a `401` and the UI asks you to sign in again.

> **Note:** sessions created before this feature existed do not carry a
> token — sign out and sign in once after pulling it.

## Backend development notes

* `backend/runserver` hot-reloads from the bind mount; migrations run only
  in the `backend` service (workers never migrate).
* New Django apps go under `backend/apps/` and are added to
  `INSTALLED_APPS` in `backend/config/settings.py`.
* Environment-driven settings: see `.env.example` and
  `backend/config/settings.py`.
* The test suite creates and drops the temporary `test_uog_db` database, so
  `pytest` connects as the **migration role** (`DB_MIGRATE_USER`) — creating
  databases is DDL that the runtime role deliberately cannot do. See
  `infrastructure/postgres/README.md` for the role separation.

## CI pipeline

`azure-pipelines.yml` builds, tests and packages the platform on every push
to `main`:

| Stage / step | What it does |
| --- | --- |
| *Build and Test* → Bootstrap PostgreSQL roles | Starts the PostgreSQL 16 service container and applies the platform role separation (`scripts/ci/postgres-service.sh`). |
| *Build and Test* → Test Backend | Installs the pinned requirements, runs `manage.py check` and the pytest suite against the service container on `localhost:5432`. |
| *Build and Test* → Build Frontend | `pnpm install --frozen-lockfile` and `pnpm build` (Turborepo builds both apps). |
| *Docker Push and Artifacts* | Builds and pushes the backend/frontend images and publishes the deployment package. |

The suite needs a **real** PostgreSQL: `pytest-django` creates and drops the
temporary `test_uog_db` database, which is database-level DDL that only the
migration role may perform. The service container therefore gets exactly the
roles the development stack uses — `uog_migrate` (owns the schema, may create
databases) and `uog_app` (runtime only, never a superuser) — through
`infrastructure/postgres/init/01-init-roles.sh`.

The CI database credentials are throwaway: they are derived from the build
id, so no static secret is committed and every build gets fresh ones. The
container is destroyed together with the agent.

Reproducing the CI database locally:

```bash
docker run -d --name uog-ci-postgres \
  -e POSTGRES_USER=uog_admin -e POSTGRES_PASSWORD=ci-postgres-admin-password \
  -e POSTGRES_DB=uog_db \
  -e DB_USER=uog_app -e DB_MIGRATE_USER=uog_migrate \
  -e DB_APP_PASSWORD=ci-app-role-password \
  -e DB_MIGRATE_PASSWORD=ci-migrate-role-password \
  -p 5432:5432 postgres:16.15-alpine

bash scripts/ci/postgres-service.sh    # waits, applies the role bootstrap, verifies it

cd backend && \
  DB_HOST=localhost DB_PORT=5432 DB_NAME=uog_db \
  DB_USER=uog_app DB_PASSWORD=ci-app-role-password \
  DB_MIGRATE_USER=uog_migrate DB_MIGRATE_PASSWORD=ci-migrate-role-password \
  pytest
```

> The frontend build step and the frontend image install with
> `--frozen-lockfile`, so `frontend/pnpm-lock.yaml` must be committed — a
> lockfile that does not match the manifests fails the build.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `frontend-*` unhealthy for minutes | First `next dev` compile can be slow; check `docker compose logs frontend-public`. |
| Backend `503` on `/health/ready` | Check `docker compose ps` — usually minio/postgres/redis not healthy yet: inspect their logs. |
| `keycloak-init` exit code 1 | Read its log: `docker compose logs keycloak-init`. Usually a wrong admin password in `.env` after a previous custom init, or Keycloak still starting. |
| Keycloak "realm already exists" | Expected on restarts — import only runs when the realm is absent. |
| Changed `package.json` but container ignores it | `docker compose up -d --build frontend-public frontend-admin` (image bakes the dependency layer). |
| Edited a frontend file but the page still shows the old code | The Next.js dev server inside the container does not receive file-system events for edits made on the host (bind mount + inotify). Restart the container: `docker compose restart frontend-public` (or `frontend-admin`). |
| `/admin` ends in a redirect loop | nginx must keep the exact `location = /admin` rule next to `location /admin/` — Next.js answers `/admin/` with a redirect to `/admin`, which would bounce back and forth otherwise. |
| Sign-in fails with "There is a problem with the server configuration" | The issuer Keycloak advertises must equal `KEYCLOAK_ISSUER`, and the server-side token/userinfo endpoints must be reachable from inside the container (see *Single sign-on* above). Check `docker compose logs frontend-public`. |
| Port already allocated | Override in `.env`: `NGINX_PORT`, `BACKEND_PORT`, `PUBLIC_WEB_PORT`, `ADMIN_WEB_PORT`, `KEYCLOAK_PORT`, `MINIO_PORT`, `POSTGRES_PORT`. |
| Weird Windows line-ending errors in containers | `git config core.autocrlf false` once; `.gitattributes` enforces LF for scripts. |
