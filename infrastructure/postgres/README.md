# PostgreSQL infrastructure

The platform uses **one shared PostgreSQL 16 instance** for all institutional
data. Multi-tenancy for the future 35+ websites is achieved with
`Organization` / `Site` row scoping on shared tables — **never** with
per-site databases or schemas.

## Databases

| Database     | Owner         | Purpose                                       |
| ------------ | ------------- | --------------------------------------------- |
| `uog_db`     | `uog_migrate` | Django application data (shared schema)       |
| `keycloak`   | `keycloak`    | Keycloak identity data (isolated instance DB) |

Keycloak runs against the **same PostgreSQL image but a separate container
and volume** (`keycloak-db`), fully isolated from application data.

## Roles (application database)

| Role          | Privileges                                                                 |
| ------------- | -------------------------------------------------------------------------- |
| `uog_migrate` | Owns `uog_db` and its schema; runs Django migrations (DDL); may create/drop the temporary test database |
| `uog_app`     | Data (DML) on every table/sequence; no DDL, no database creation, never superuser |

The backend container applies migrations with `DB_MIGRATE_USER` and serves
requests with `DB_USER` (see `backend/entrypoint.sh`). Neither role is a
superuser; the superuser (`uog_admin`) exists only for bootstrap. The test
suite also connects as the migration role, because creating and dropping
`test_uog_db` is database-level DDL the runtime role must never be able to
do (see the note in `backend/config/settings.py`).

## Initialisation and grant repair

Initialisation scripts live in `init/` and run automatically on **first**
container start (empty data volume).

`01-init-roles.sh` is idempotent. Besides creating the roles, it grants the
runtime role data access to *existing* objects and registers the default
privileges that cover objects created later. On a volume that was initialised
before this script existed (or by an older copy of it), grants are therefore
missing — re-run it once to repair them:

```bash
docker compose exec -T postgres sh -s < infrastructure/postgres/init/01-init-roles.sh
```

Re-running is safe: roles are only created when missing, passwords are
re-applied from the environment, table ownership is corrected back to
`uog_migrate`, and the grants/`ALTER DEFAULT PRIVILEGES` statements are
naturally repeatable.
