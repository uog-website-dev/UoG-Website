# P1-ORG-001 foundation audit

Audit date: 2026-10-23 (Africa/Nairobi). Branch: `P1-ORG-001`.
Baseline commit: `6b4649e` (merged P1-SETUP-001). The organizations
implementation was already staged when this audit began; it is not part
of that baseline commit.

## Acceptance criteria

| Criterion | Evidence / result |
| --- | --- |
| Django module created and registered | `backend/apps/organizations/apps.py`; `apps.organizations` in `INSTALLED_APPS`; app registry test passes. |
| P0 structure | Reuses the existing Django project under `backend/`, with the domain at the location specified by the baseline `docs/architecture/overview.md`. Contains `models`, `services`, `selectors`, `api`, `admin`, `migrations`, and `tests` packages. No replacement project or pipeline. |
| Isolation | Production domain packages have no imports from core, api, or accounts; boundary checks pass. |
| Migration package initialized | `organizations/migrations/__init__.py`; no organization models or schema migrations. |
| API namespace prepared | `organizations/api/urls.py`, mounted at `/api/organizations/`, namespace `organizations`, empty URL patterns. A request to the reserved prefix returns 404 as expected. |
| Tests prepared | Nine domain tests discovered by the existing pytest command alongside the platform tests. |
| Import / circular dependency check | All domain packages import under Django setup; registry and system checks pass. |
| Application startup | Backend built and starts in Docker; `/health/live` returns `{"status": "ok"}`. Readiness is blocked by unavailable MinIO. |
| Existing migrations | Regression test creates a PostgreSQL test database, applies existing migrations, and checks `api.0001_initial` and `accounts.0001_initial` are recorded. |
| Existing automated tests | Full backend suite: **49 passed in 7.75s** locally, then **49 passed in 5.76s** inside the Python 3.12 Docker image against PostgreSQL. |
| CI pipeline passes | **Unverified**: no PR exists for this branch, and no hosted CI result for these uncommitted changes is available. Local checks do not establish hosted CI success. |

The repository's P0 architecture overview confirms the domain location.
A separately approved P0-006 specification/sign-off was not found in the
repository, so exact compliance with an external approval cannot be certified.

## Scope review

No organization entities, hierarchy, business operations, endpoints, RBAC,
or frontend UI were added. The empty responsibility packages establish the
requested boundary without speculative unit-specific modules.

The staged `backend/apps/api/migrations/__init__.py` repairs discovery of
the already existing `0001_initial.py`; it introduces no new migration.
Keep this repair because the regression test verifies that migration loads
and applies normally.

## Verification

Local test command, from `backend/` (PowerShell):

```powershell
$env:DB_HOST = 'localhost'
$env:DEBUG = 'False'
.\.venv\Scripts\python.exe -m pytest
```

```text
49 passed in 7.75s
```

`DEBUG` is set explicitly because this host supplies an unrelated value
(`release`) which python-decouple cannot parse as a boolean.

Additional local checks against PostgreSQL:

```text
python manage.py check
System check identified no issues (0 silenced).

python manage.py makemigrations --check --dry-run
No changes detected

python manage.py showmigrations organizations api accounts
organizations
 (no migrations)
api
 [X] 0001_initial
accounts
 [X] 0001_initial

python manage.py migrate --check
(exit 0)

docker compose config --quiet
(exit 0)
```

Frontend regression tests run inside the newly built `uog-frontend:dev`
image with `docker run --rm --entrypoint pnpm uog-frontend:dev test`:
**8 tests passed**, across `@uog/api-client` (5) and `@uog/ui` (3);
Turborepo reports `2 successful, 2 total` (exit 0).

The CI frontend build command was also reproduced in that image:
`docker run --rm --entrypoint pnpm uog-frontend:dev build`.
Both Next.js production builds passed, including lint/type checks and
page generation (`2 successful, 2 total`, exit 0).

## Docker execution

`docker compose up -d --build` was attempted. It failed while pulling
`minio/minio:RELEASE.2025-09-07T16-13-09Z`:

```text
pull access denied for minio/minio, repository does not exist or may require 'docker login'
```

A direct pull of the same image reproduced the failure. This image is
pinned in the baseline Compose configuration; the failure occurs before
the organizations application executes. Full-stack readiness and the
end-to-end smoke suite remain blocked until the image is accessible or
the infrastructure configuration supplies a working approved image.

Both backend and frontend images built successfully. The backend was
started with `DEBUG=True` explicitly, because the host's `DEBUG=release`
also propagates through Compose. Startup ran existing migrations as the
migration role successfully. With MinIO unavailable, the backend was
started using `docker compose up -d --no-build --no-deps backend`.

Container verification:

```text
docker compose exec -T backend pytest
49 passed in 5.76s

docker compose exec -T backend python manage.py check
System check identified no issues (0 silenced).

docker compose exec -T backend python manage.py makemigrations --check --dry-run
No changes detected

docker compose exec -T backend python manage.py migrate --check
(exit 0)
```

Container `showmigrations` also confirms no organization migrations and
both existing application migrations applied.

The frontend image built successfully. PostgreSQL, Keycloak and its
database, both Redis instances, and both frontend development services
were started independently and reached healthy status. Direct requests to
`http://localhost:3000/` and `http://localhost:3001/admin/` returned HTTP 200.
The initial simultaneous frontend creation hit a shared-volume symlink
copy race; retrying service startup sequentially succeeded without deleting
volumes or changing configuration.

Starting Nginx exposed pre-existing configuration errors: an `if` in the
`http` context and a missing closing brace. The audit fixes these startup
defects in `infrastructure/nginx/nginx.conf`, retaining host rejection in
the existing server block. Its loopback regex now uses literal-dot
character classes. `nginx -t` passes; requests with `localhost` and
`127.0.0.1` succeed, while an unknown Host is rejected (curl exit 52,
empty response, consistent with Nginx 444). This infrastructure repair
is separate from the organizations foundation implementation.

Celery worker and beat were started independently, and Keycloak
initialization exited successfully. Smoke checks confirm task execution,
the scheduled heartbeat, Redis cache round-trip, and least-privilege
runtime database access.

The smoke run also exposed existing identity integration failures. A token
issued to the development user has no `preferred_username` or
`realm_access` claims and an empty `scope`. The API accepts the token, but
`/api/me/` returns the subject ID as its username with no roles, and
`/api/admin/overview/` returns 403. Keycloak initialization exited 0 despite
these missing claims. No identity, realm, or RBAC code was changed in this
audit; this integration needs follow-up before confirming earlier stories
still work end to end.

Final smoke command (Git Bash, from the repository root):

```text
bash scripts/smoke-test.sh
Passed: 21   Failed: 4
Failed checks:
  - backend readiness (request failed)
  - minio buckets, upload, retrieval and signed URL
  - token-carrying request to /api/me/ returns the identity
  - role-protected /api/admin/overview/ accepts the platform-admin token
(exit 1)
```

Docker services are left running for inspection. The backend serves HTTP
but its readiness health check is unhealthy because MinIO is absent.
Nginx, the frontends, PostgreSQL databases, Redis instances, Keycloak, and
the Celery worker are healthy; beat is running without a configured health
check. Keycloak initialization completed successfully; MinIO and its
initialization service could not start.

## Completion evidence still required

- Merged story PR / commit: pending; baseline commit is not story evidence.
- Migration reference: no organization migration is required; existing
  `api.0001_initial` and `accounts.0001_initial` are covered by regression tests.
- API/schema reference: reserved namespace above; no new API operations or
  schema changes apply to this foundation story.
- Hosted CI run URL and passing result: pending.
- Full-stack smoke verification after resolving the MinIO image pull.
- Restore the development user's username and role claims in Keycloak
  tokens, then verify identity and role-protected API smoke checks.

The backend regression suite passes. Full platform regression freedom and
story closure cannot be claimed while the remaining evidence is pending.
