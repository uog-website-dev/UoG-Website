# Health endpoints

## Django backend

### `GET /health/live` — liveness

The process is up and can serve requests. Touches **no** dependencies.

```json
{ "status": "ok" }
```

Use for container liveness probes.

### `GET /health/ready` — readiness

Verifies the critical dependencies: PostgreSQL (round-trip query), Redis
cache (set/get) and MinIO (head-bucket on the default bucket).

* `200` — all dependencies reachable
* `503` — one or more dependencies down (per-check detail included; only the
  exception class name is exposed, never credentials or internals)

```json
{
  "status": "ok",
  "checks": {
    "database":       { "status": "ok", "latency_ms": 2.1 },
    "cache":          { "status": "ok", "latency_ms": 1.4 },
    "object_storage": { "status": "ok", "latency_ms": 5.9 }
  }
}
```

### `GET /health/` — legacy alias

Kept for backward compatibility; behaves like `/health/live`.

All three are reachable directly (`http://localhost:8000/...`) and through
nginx (`http://localhost/health/...`).

## Container health checks

| Service | Check |
| --- | --- |
| postgres / keycloak-db | `pg_isready` |
| redis-cache / redis-broker | `redis-cli ping` |
| minio | `GET http://localhost:9000/minio/health/live` |
| keycloak | TCP connect on `:8080` (image ships no curl); realm-level readiness enforced by `keycloak-init` |
| backend | `GET /health/ready` |
| celery-worker | `celery -A config inspect ping` (broker round-trip) |
| frontend-public / frontend-admin | `GET /` resp. `GET /admin` |
| nginx | `GET /nginx-health` |
| minio-init / keycloak-init | one-shot; must exit 0 (`service_completed_successfully`) |

Frontend apps do not yet expose their own health routes (arrives with the
identity/CMS stories); their container checks probe the rendered page.

## Nginx

`GET /nginx-health` returns `200 ok` — verifies the proxy itself, not its
upstreams (upstream failures surface as `502`).
