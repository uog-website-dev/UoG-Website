#!/usr/bin/env bash
# UoG Digital Platform — automated smoke tests for the development stack.
#
# Verifies the complete platform end to end: nginx routing, both Next.js
# apps, Django + database role separation + migrations, Redis, Celery
# (worker + beat), MinIO operations, and Keycloak token issuance.
#
# Usage:  bash scripts/smoke-test.sh        (stack must be running)
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost}"
BACKEND_URL="${BACKEND_URL:-http://localhost:8000}"
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8080}"

PASS=0
FAIL=0
FAILED_NAMES=()

pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL + 1)); FAILED_NAMES+=("$1"); }

check_http() { # name url [expected_substring]
  local name="$1" url="$2" substr="${3:-}" body
  if body=$(curl -fsS -m 20 "$url" 2>/dev/null); then
    if [ -z "$substr" ] || grep -q "$substr" <<<"$body"; then
      pass "$name"
    else
      fail "$name (response did not contain '$substr')"
    fi
  else
    fail "$name (request failed)"
  fi
}

check_exec() { # name service cmd...
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then pass "$name"; else fail "$name"; fi
}

echo "UoG Digital Platform — smoke tests"
echo "==================================="

# Load development secrets for the Keycloak checks (gitignored .env).
if [ -f .env ]; then set -a; . ./.env; set +a; fi
KEYCLOAK_BACKEND_API_SECRET="${KEYCLOAK_BACKEND_API_SECRET:-backend-api-dev-secret}"
KEYCLOAK_DEV_USERNAME="${KEYCLOAK_DEV_USERNAME:-devuser}"
KEYCLOAK_DEV_PASSWORD="${KEYCLOAK_DEV_PASSWORD:-DevUser!2026}"

echo
echo "--- container states ---"
docker compose ps --format 'table {{.Service}}\t{{.Status}}' 2>/dev/null || true

echo
echo "--- nginx routing ---"
check_http "nginx serves the public website"      "$BASE_URL/"               "Digital Platform"
check_http "nginx routes /admin to admin-web"     "$BASE_URL/admin/"         "Admin"
check_http "nginx routes /api to Django"          "$BASE_URL/api/pages/"     "count"
check_http "nginx routes /health to backend"      "$BASE_URL/health/live"    '"ok"'
check_http "nginx self-check endpoint"            "$BASE_URL/nginx-health"   "ok"
check_http "nginx exposes Django admin"           "$BASE_URL/django-admin/login/" "Django administration"

echo
echo "--- frontend apps (direct ports) ---"
check_http "public-web responds on :3000"   "http://localhost:3000/"       "Digital Platform"
check_http "admin-web responds on :3001"    "http://localhost:3001/admin/" "Admin"

echo
echo "--- backend + database ---"
check_http "backend liveness"        "$BACKEND_URL/health/live"  '"ok"'
check_http "backend readiness"       "$BACKEND_URL/health/ready" '"status": "ok"'
check_http "sample API response"     "$BACKEND_URL/api/pages/"   "count"

check_exec "runtime DB role is uog_app (not a superuser)" \
  docker compose exec -T -e DJANGO_SETTINGS_MODULE=config.settings backend python -c "
import django
django.setup()
from django.db import connection
with connection.cursor() as c:
    c.execute('SELECT current_user, usesuper FROM pg_user WHERE usename = current_user')
    user, superuser = c.fetchone()
assert user == 'uog_app', f'unexpected runtime role: {user}'
assert superuser is False, 'runtime role must not be a superuser'
"

if docker compose exec -T backend python manage.py showmigrations --plan 2>/dev/null | grep -q '\[ \]'; then
  fail "all Django migrations applied"
else
  pass "all Django migrations applied"
fi

echo
echo "--- redis ---"
if [ "$(docker compose exec -T redis-cache redis-cli ping 2>/dev/null | tr -d '\r')" = "PONG" ]; then
  pass "redis-cache answers PING"
else
  fail "redis-cache answers PING"
fi
if [ "$(docker compose exec -T redis-broker redis-cli ping 2>/dev/null | tr -d '\r')" = "PONG" ]; then
  pass "redis-broker answers PING"
else
  fail "redis-broker answers PING"
fi
check_exec "Django cache round-trip (Redis)" \
  docker compose exec -T -e DJANGO_SETTINGS_MODULE=config.settings backend python -c "
import django
django.setup()
from django.core.cache import cache
cache.set('smoke:test', 'ok', 20)
assert cache.get('smoke:test') == 'ok'
"

echo
echo "--- celery worker ---"
# `celery call` only prints the task id — the result is fetched from the
# result backend (Redis) to prove the worker really executed the task.
CELERY_TASK_ID="$(docker compose exec -T backend celery -A config call core.ping --args '["smoke-test"]' 2>/dev/null | tr -d '\r' | tail -1)"
CELERY_OK=0
if [ -n "$CELERY_TASK_ID" ]; then
  for _ in $(seq 1 10); do
    CELERY_RESULT="$(docker compose exec -T backend celery -A config result "$CELERY_TASK_ID" 2>/dev/null | tr -d '\r' | tail -1)"
    case "$CELERY_RESULT" in
      *smoke-test*) CELERY_OK=1; break ;;
    esac
    sleep 2
  done
fi
if [ "$CELERY_OK" = "1" ]; then
  pass "celery worker executes a submitted task"
else
  fail "celery worker executes a submitted task"
fi

echo "--- celery beat (scheduled task, may take up to ~90s) ---"
BEAT_OK=0
for _ in $(seq 1 10); do
  if docker compose logs celery-worker 2>/dev/null | grep -q "core.scheduled_heartbeat"; then
    BEAT_OK=1
    break
  fi
  sleep 10
done
if [ "$BEAT_OK" = "1" ]; then
  pass "celery beat schedule executed the heartbeat task"
else
  fail "celery beat schedule executed the heartbeat task"
fi

echo
echo "--- minio object storage ---"
if docker compose exec -T backend python - <<'PY' >/dev/null 2>&1
import os
import urllib.request

import boto3
from botocore.config import Config

client = boto3.client(
    "s3",
    endpoint_url=os.environ["MINIO_ENDPOINT"],
    aws_access_key_id=os.environ["MINIO_ACCESS_KEY"],
    aws_secret_access_key=os.environ["MINIO_SECRET_KEY"],
    region_name="us-east-1",
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
)
buckets = {b["Name"] for b in client.list_buckets()["Buckets"]}
required = {"platform-public", "platform-private", "platform-documents"}
assert required <= buckets, f"missing buckets: {required - buckets}"

payload = b"uog smoke test object"
client.put_object(Bucket="platform-private", Key="smoke/test.txt", Body=payload)
assert client.get_object(Bucket="platform-private", Key="smoke/test.txt")["Body"].read() == payload

signed_url = client.generate_presigned_url(
    "get_object",
    Params={"Bucket": "platform-private", "Key": "smoke/test.txt"},
    ExpiresIn=120,
)
assert urllib.request.urlopen(signed_url, timeout=15).read() == payload

policy = client.get_bucket_policy(Bucket="platform-public")["Policy"]
assert "s3:GetObject" in policy, "platform-public should allow public read"
PY
then
  pass "minio buckets, upload, retrieval and signed URL"
else
  fail "minio buckets, upload, retrieval and signed URL"
fi

echo
echo "--- keycloak identity provider ---"
check_http "OIDC discovery (realm uog)" \
  "$KEYCLOAK_URL/realms/uog/.well-known/openid-configuration" "authorization_endpoint"

TOKEN=$(curl -fsS -m 15 -X POST "$KEYCLOAK_URL/realms/uog/protocol/openid-connect/token" \
  -d "grant_type=client_credentials" \
  -d "client_id=backend-api" \
  -d "client_secret=$KEYCLOAK_BACKEND_API_SECRET" 2>/dev/null | grep -o '"access_token":"[^"]*"' | head -1)
if [ -n "$TOKEN" ]; then
  pass "client-credentials token issued (backend-api)"
else
  fail "client-credentials token issued (backend-api)"
fi

TOKEN2=$(curl -fsS -m 15 -X POST "$KEYCLOAK_URL/realms/uog/protocol/openid-connect/token" \
  -d "grant_type=password" \
  -d "client_id=backend-api" \
  -d "client_secret=$KEYCLOAK_BACKEND_API_SECRET" \
  -d "username=$KEYCLOAK_DEV_USERNAME" \
  -d "password=$KEYCLOAK_DEV_PASSWORD" 2>/dev/null | grep -o '"access_token":"[^"]*"' | head -1)
if [ -n "$TOKEN2" ]; then
  pass "development user authentication ($KEYCLOAK_DEV_USERNAME)"
else
  fail "development user authentication ($KEYCLOAK_DEV_USERNAME)"
fi

echo
echo "--- django API accepts keycloak access tokens ---"
ACCESS_TOKEN="${TOKEN2#\"access_token\":\"}"
ACCESS_TOKEN="${ACCESS_TOKEN%\"}"

# Protected endpoint: 401 for anonymous callers (through nginx) …
ME_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -m 15 "$BASE_URL/api/me/" 2>/dev/null)
if [ "$ME_STATUS" = "401" ]; then
  pass "anonymous request to /api/me/ is rejected (401)"
else
  fail "anonymous request to /api/me/ is rejected (401) — got $ME_STATUS"
fi

# … and 200 with the development user's token, which Django validates against
# the realm JWKS and provisions into a local account.
if [ -n "$ACCESS_TOKEN" ] && curl -fsS -m 15 -H "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/api/me/" 2>/dev/null | grep -q "$KEYCLOAK_DEV_USERNAME"; then
  pass "token-carrying request to /api/me/ returns the identity"
else
  fail "token-carrying request to /api/me/ returns the identity"
fi

if [ -n "$ACCESS_TOKEN" ] && curl -fsS -m 15 -H "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/api/admin/overview/" 2>/dev/null | grep -q "requested_by"; then
  pass "role-protected /api/admin/overview/ accepts the platform-admin token"
else
  fail "role-protected /api/admin/overview/ accepts the platform-admin token"
fi

echo
echo "==================================="
echo "Passed: $PASS   Failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'Failed checks:\n'
  printf '  - %s\n' "${FAILED_NAMES[@]}"
  exit 1
fi
echo "All smoke tests passed."
