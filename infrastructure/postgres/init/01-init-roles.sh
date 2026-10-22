#!/bin/sh
# UoG Digital Platform — PostgreSQL bootstrap (role separation + grants).
#
# Approved P0 privilege separation for the SHARED application database:
#   * uog_migrate — owns the schema; the only role allowed to run DDL
#                   (Django migrations run as this role).
#   * uog_app     — least-privilege runtime role used by Django; it can
#                   read/write data but cannot create or drop schema
#                   objects, and is never a superuser.
#
# The script is idempotent: it runs on first start (empty data volume) as
# usual, and can be re-run against an EXISTING volume to repair grants that
# are missing there (a volume initialised before this script existed, or by
# an older copy of it, has no default privileges and therefore no runtime
# access to tables the migration role created later):
#
#   docker compose exec -T postgres sh -s < infrastructure/postgres/init/01-init-roles.sh
#
# Passwords arrive from the environment (docker-compose.yml) — never from
# files committed to git.
set -e

# Fail fast rather than ever applying an empty password to a role.
: "${POSTGRES_USER:?POSTGRES_USER must be set}"
: "${POSTGRES_DB:?POSTGRES_DB must be set}"
: "${DB_MIGRATE_PASSWORD:?DB_MIGRATE_PASSWORD must be set}"
: "${DB_APP_PASSWORD:?DB_APP_PASSWORD must be set}"

# Role names arrive from the environment (docker-compose.yml) with the same
# variable names the backend uses, so renaming a role stays consistent.
MIGRATE_ROLE="${DB_MIGRATE_USER:-uog_migrate}"
APP_ROLE="${DB_USER:-uog_app}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --set=migrate_role="$MIGRATE_ROLE" \
    --set=app_role="$APP_ROLE" \
    --set=db_name="$POSTGRES_DB" \
    --set=migrate_password="$DB_MIGRATE_PASSWORD" \
    --set=app_password="$DB_APP_PASSWORD" <<-'EOSQL'
    -- Roles (logins; never superusers). Created only when missing, and the
    -- passwords are re-applied from the environment, so re-running the
    -- script neither fails nor leaves stale credentials behind.
    SELECT format('CREATE ROLE %I WITH LOGIN PASSWORD %L', :'migrate_role', :'migrate_password')
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migrate_role')
\gexec

    SELECT format('CREATE ROLE %I WITH LOGIN PASSWORD %L', :'app_role', :'app_password')
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role')
\gexec

    ALTER ROLE :"migrate_role" WITH LOGIN PASSWORD :'migrate_password';
    ALTER ROLE :"app_role" WITH LOGIN PASSWORD :'app_password';

    -- The migration role may CREATE/DROP the temporary test database as well
    -- as run DDL inside it (neither is a superuser power, but both stay out
    -- of reach of the runtime role).
    ALTER ROLE :"migrate_role" WITH CREATEDB;

    -- Hardened invariant for the runtime role: it connects and reads/writes
    -- data, and can never create databases, roles or objects outside grants.
    ALTER ROLE :"app_role" WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

    -- The migration role owns the shared database and its public schema.
    ALTER DATABASE :"db_name" OWNER TO :"migrate_role";
    GRANT USAGE, CREATE ON SCHEMA public TO :"migrate_role";

    -- Runtime role may connect, but cannot create schema objects.
    GRANT CONNECT ON DATABASE :"db_name" TO :"app_role";
    GRANT USAGE ON SCHEMA public TO :"app_role";

    -- Keep the default privileges in the public schema locked down.
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;

    -- The schema owner owns every object in it — repairs tables or sequences
    -- created by an earlier run that executed migrations as the runtime role.
    SELECT format('ALTER TABLE %I.%I OWNER TO %I', schemaname, tablename, :'migrate_role')
    FROM pg_tables
    WHERE schemaname = 'public' AND tableowner <> :'migrate_role'
\gexec

    SELECT format('ALTER SEQUENCE %I.%I OWNER TO %I', schemaname, sequencename, :'migrate_role')
    FROM pg_sequences
    WHERE schemaname = 'public' AND sequenceowner <> :'migrate_role'
\gexec

    -- Existing objects: the runtime role gets data access to everything the
    -- migration role owns. This is the repair for volumes that were
    -- initialised before the default privileges below were in place.
    GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES
        ON ALL TABLES IN SCHEMA public TO :"app_role";
    GRANT USAGE, SELECT
        ON ALL SEQUENCES IN SCHEMA public TO :"app_role";
    GRANT EXECUTE
        ON ALL FUNCTIONS IN SCHEMA public TO :"app_role";

    -- Future objects: every table/sequence the migration role creates is
    -- automatically granted to the runtime role (no DDL for it, ever).
    ALTER DEFAULT PRIVILEGES FOR ROLE :"migrate_role" IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES ON TABLES TO :"app_role";
    ALTER DEFAULT PRIVILEGES FOR ROLE :"migrate_role" IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";
    ALTER DEFAULT PRIVILEGES FOR ROLE :"migrate_role" IN SCHEMA public
        GRANT EXECUTE ON FUNCTIONS TO :"app_role";
EOSQL

echo "==> Database roles initialised (uog_migrate owns schema, uog_app is runtime-only)"
