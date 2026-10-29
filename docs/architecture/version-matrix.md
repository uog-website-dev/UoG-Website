# Technology version matrix (reconciled)

Status: **proposed for technical-lead approval** (P0 story requirement).
All entries were reconciled against live registries on 2026-10-21 and are
pinned exactly in project configuration. Floating `latest` tags are not used
anywhere.

## Conflict resolutions

The P0 reports disagreed on React, Redis and Keycloak. Resolutions:

| Conflict | Resolution | Rationale |
| --- | --- | --- |
| React 18 (P0 demo CRA app) vs React 19 | **React 19.2.9** | The approved stack is Next.js 15 App Router, which supports React 19; MUI v6 lists React 19 in its peer range. The CRA demo is superseded by this foundation. |
| Redis 6 vs Redis 7 | **Redis 7.4.11** | Current maintained stable line; supports the split broker strategy (AOF + `noeviction`) and cache eviction policies required by the P0 decision. Two separate instances are used (cache vs broker). |
| Keycloak 24/25 vs 26 | **Keycloak 26.8.1** | Current stable LTS line with the `KC_BOOTSTRAP_ADMIN_*` bootstrap model and supported `--import-realm` workflow; verified compatible with Auth.js v5 OIDC discovery. |

## Backend

| Component | Version | Pinned in |
| --- | --- | --- |
| Python | 3.12.15 | `backend/Dockerfile` (`python:3.12.15-slim-bookworm`) |
| Django | 5.1.8 | `backend/requirements/base.txt` |
| Django REST Framework | 3.15.2 | `backend/requirements/base.txt` |
| drf-spectacular | 0.30.0 | `backend/requirements/base.txt` (OpenAPI generation/validation) |
| drf-spectacular-sidecar | 2026.10.1 | `backend/requirements/base.txt` (self-hosted Swagger/ReDoc assets) |
| WhiteNoise | 6.12.0 | `backend/requirements/base.txt` (static assets with DEBUG=False) |
| django-cors-headers | 4.9.0 | `backend/requirements/base.txt` |
| python-decouple | 3.8 | `backend/requirements/base.txt` (existing convention kept) |
| psycopg (v3 binary) | 3.3.6 | `backend/requirements/base.txt` |
| gunicorn | 23.0.0 | `backend/requirements/base.txt` |
| Celery | 5.4.0 | `backend/requirements/base.txt` |
| redis (Python client) | 5.2.1 | `backend/requirements/base.txt` |
| django-storages\[s3\] | 1.14.6 | `backend/requirements/base.txt` |
| boto3 | 1.35.84 | `backend/requirements/base.txt` |
| PyJWT\[crypto\] | 2.15.1 | `backend/requirements/base.txt` (OIDC access-token validation) |
| cryptography | 46.0.3 | `backend/requirements/base.txt` (RS256 signature verification) |
| nh3 | 0.3.7 | `backend/requirements/base.txt` (allowlist HTML sanitizer for block rich text — XSS payloads cannot be stored) |
| pytest / pytest-django | 8.4.2 / 4.14.0 | `backend/requirements/dev.txt` |

## Frontend

| Component | Version | Pinned in |
| --- | --- | --- |
| Node.js (containers) | 22.23.3 | `frontend/Dockerfile` (`node:22.23.3-alpine`) |
| pnpm | 9.15.9 | `frontend/package.json` `packageManager`, `frontend/Dockerfile` |
| Turborepo | 2.11.10 | `frontend/package.json`, `frontend/turbo.json` |
| Next.js | 15.5.28 | app `package.json`s |
| React / React DOM | 19.2.9 | app + ui `package.json`s |
| TypeScript | 5.6.3 | workspace root + packages |
| Material UI | @mui/material 6.5.0 | `frontend/packages/ui`, apps |
| @mui/material-nextjs (SSR) | 6.5.0 | `frontend/packages/ui` |
| Auth.js (NextAuth v5) | 5.0.0-beta.32 | app `package.json`s |
| Vitest | 5.0.5 | `packages/api-client`, `packages/ui` |

Dependency lockfiles: `frontend/pnpm-lock.yaml` (committed).

## Infrastructure images

| Service | Image | Notes |
| --- | --- | --- |
| postgres | `postgres:16.15-alpine` | app DB **and** Keycloak DB (separate containers/volumes) |
| redis | `redis:7.4.11-alpine` | two instances: cache + broker |
| minio | `pgsty/silo:RELEASE.2026-10-18T00-00-00Z` | S3-compatible server. Upstream `minio/minio` is not anonymously pullable. |
| keycloak | `quay.io/keycloak/keycloak:26.8.1` | realm auto-import |
| nginx | `nginx:1.31.7-alpine` | reverse proxy |
| backend | built from `backend/` | base `python:3.12.15-slim-bookworm` |
| frontend | built from `frontend/` | base `node:22.23.3-alpine` |

## Search baseline

PostgreSQL Full-Text Search (`tsvector`/`gin`) on the shared database — no
additional service in this story; indexes arrive with the content stories.
