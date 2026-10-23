#!/bin/sh
# UoG frontend entrypoint.
# Reconciles node_modules with the committed lockfile (fast no-op when the
# named volumes are already warm), then starts the requested command.
set -e

echo "==> UoG frontend entrypoint"
echo "==> Installing workspace dependencies (pnpm)..."
# Both frontends share the pnpm store and most node_modules volumes. Starting
# together would run pnpm installs against the same project concurrently, which
# pnpm does not support (store/node_modules imports race and fail with
# ERR_PNPM_ENOENT). Serialize the reconcile step on a lock in the shared store.
flock -x /pnpm-store/.install.lock pnpm install --frozen-lockfile

echo "==> Starting: $*"
exec "$@"
