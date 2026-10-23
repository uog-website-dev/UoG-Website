#!/bin/sh
# UoG Digital Platform — backend entrypoint.
# Applies migrations with the dedicated MIGRATION database role, then starts
# the given command (the runtime connects as the application role).
set -e

echo "==> UoG backend entrypoint"

wait_for_db() {
    host="$1"
    port="$2"
    user="$3"
    echo "==> Waiting for PostgreSQL at ${host}:${port} (role ${user})..."
    i=0
    until pg_isready -h "$host" -p "$port" -U "$user" >/dev/null 2>&1; do
        i=$((i + 1))
        if [ "$i" -ge 60 ]; then
            echo "ERROR: PostgreSQL did not become ready in time" >&2
            exit 1
        fi
        sleep 1
    done
    echo "==> PostgreSQL is ready"
}

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    wait_for_db "${DB_HOST:-postgres}" "${DB_PORT:-5432}" "${DB_MIGRATE_USER:-uog_migrate}"
    echo "==> Applying migrations as the migration role..."
    DB_USER="${DB_MIGRATE_USER:-uog_migrate}" \
    DB_PASSWORD="${DB_MIGRATE_PASSWORD:-uog_migrate_password}" \
        python manage.py migrate --noinput
    echo "==> Migrations complete"
fi

if [ "${RUN_MAKEMIGRATIONS:-false}" = "true" ]; then
    echo "==> Generating new migrations (RUN_MAKEMIGRATIONS=true)..."
    DB_USER="${DB_MIGRATE_USER:-uog_migrate}" \
    DB_PASSWORD="${DB_MIGRATE_PASSWORD:-uog_migrate_password}" \
        python manage.py makemigrations --noinput || true
fi

if [ "${RUN_COLLECTSTATIC:-false}" = "true" ]; then
    echo "==> Collecting static files..."
    python manage.py collectstatic --noinput
fi

echo "==> Starting: $*"
exec "$@"
