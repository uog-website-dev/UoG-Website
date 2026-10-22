#!/usr/bin/env bash
# UoG Digital Platform — bootstrap the PostgreSQL service used by CI.
#
# The Azure pipeline starts a PostgreSQL *service container* (see
# azure-pipelines.yml). This script waits until it accepts connections and
# then applies the platform's role separation by running the very same
# bootstrap script the development stack uses
# (infrastructure/postgres/init/01-init-roles.sh):
#
#   uog_migrate — owns the schema, runs the DDL, may create/drop the
#                 temporary test database the suite needs
#   uog_app     — least-privilege runtime role, never a superuser
#
# Usage:
#   bash scripts/ci/postgres-service.sh [container-id-or-name]
#
# Without an argument the running container is discovered by image. The
# container's own environment carries the credentials (POSTGRES_USER,
# POSTGRES_DB, DB_MIGRATE_PASSWORD, DB_APP_PASSWORD, …) — never a secret
# is passed on the command line or read from a file.
set -euo pipefail

POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16.15-alpine}"
ADMIN_USER="${POSTGRES_ADMIN_USER:-uog_admin}"
ADMIN_DB="${POSTGRES_ADMIN_DB:-uog_db}"
MIGRATE_ROLE="${DB_MIGRATE_USER:-uog_migrate}"
APP_ROLE="${DB_USER:-uog_app}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INIT_SCRIPT="${SCRIPT_DIR}/../../infrastructure/postgres/init/01-init-roles.sh"

if [ ! -f "$INIT_SCRIPT" ]; then
  echo "ERROR: role bootstrap script not found at ${INIT_SCRIPT}" >&2
  exit 1
fi

container_id() {
  if [ -n "${1:-}" ]; then
    printf '%s' "$1"
    return
  fi
  # Azure names the service container after the service alias; the image is
  # the reliable selector. The fallback covers registries that report the
  # fully qualified image name (docker.io/library/postgres:…).
  local id
  id="$(docker ps --filter "ancestor=${POSTGRES_IMAGE}" --format '{{.ID}}' | head -1)"
  if [ -z "$id" ]; then
    id="$(docker ps --format '{{.Image}} {{.ID}}' | awk 'tolower($1) ~ /postgres/ {print $2; exit}')"
  fi
  printf '%s' "$id"
}

# --- 1. wait for the service container -------------------------------------
cid=""
for _ in $(seq 1 60); do
  cid="$(container_id "${1:-}")"
  if [ -n "$cid" ] && docker exec "$cid" pg_isready -U "$ADMIN_USER" -d "$ADMIN_DB" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if [ -z "$cid" ]; then
  echo "ERROR: no '${POSTGRES_IMAGE}' container is running on this agent" >&2
  exit 1
fi

if ! docker exec "$cid" pg_isready -U "$ADMIN_USER" -d "$ADMIN_DB" >/dev/null 2>&1; then
  echo "ERROR: PostgreSQL did not become ready in time" >&2
  docker logs "$cid" >&2 || true
  exit 1
fi
echo "==> PostgreSQL service container ${cid} is accepting connections"

# --- 2. apply the platform role separation --------------------------------
# The script reads the credentials from the container's environment and is
# idempotent, so re-running it never fails.
docker exec -i "$cid" sh -s < "$INIT_SCRIPT"

# --- 3. verify the roles the test suite needs ------------------------------
roles="$(docker exec "$cid" psql -U "$ADMIN_USER" -d "$ADMIN_DB" -tAc \
  "SELECT rolname FROM pg_roles WHERE rolname IN ('${MIGRATE_ROLE}', '${APP_ROLE}') ORDER BY 1")"

for role in "$MIGRATE_ROLE" "$APP_ROLE"; do
  if ! grep -qx "$role" <<<"$roles"; then
    echo "ERROR: role '${role}' is missing after the bootstrap" >&2
    exit 1
  fi
done

# The runtime role must stay least-privilege: no database creation, no
# superuser. The migration role must be able to create the test database.
if docker exec "$cid" psql -U "$ADMIN_USER" -d "$ADMIN_DB" -tAc \
  "SELECT rolsuper OR rolcreatedb FROM pg_roles WHERE rolname = '${APP_ROLE}'" | grep -qx t; then
  echo "ERROR: the runtime role '${APP_ROLE}' must not be a superuser and must not create databases" >&2
  exit 1
fi

if [ "$(docker exec "$cid" psql -U "$ADMIN_USER" -d "$ADMIN_DB" -tAc \
  "SELECT rolcreatedb FROM pg_roles WHERE rolname = '${MIGRATE_ROLE}'")" != "t" ]; then
  echo "ERROR: the migration role '${MIGRATE_ROLE}' must be able to create the test database" >&2
  exit 1
fi

echo "==> Database roles ready (${MIGRATE_ROLE} owns the schema, ${APP_ROLE} is runtime-only)"
