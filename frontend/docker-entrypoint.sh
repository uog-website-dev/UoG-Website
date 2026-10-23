#!/bin/sh
# UoG frontend entrypoint.
# Reconciles node_modules with the committed lockfile (fast no-op when the
# named volumes are already warm), then starts the requested command.
set -e

echo "==> UoG frontend entrypoint"
echo "==> Installing workspace dependencies (pnpm)..."
pnpm install --frozen-lockfile

echo "==> Starting: $*"
exec "$@"
