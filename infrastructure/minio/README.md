# MinIO infrastructure

MinIO provides S3-compatible object storage for platform media and documents.

## Approved buckets

| Bucket             | Access                  | Purpose                                       |
| ------------------ | ----------------------- | --------------------------------------------- |
| `platform-public`  | public read (GetObject) | Publicly servable assets (logos, banners, …)  |
| `platform-private` | signed URLs only        | Private media (default Django file storage)   |
| `platform-documents` | signed URLs only      | Institutional documents                       |

Buckets are created **once** by the `minio-init` service, which runs the
Django management command `python manage.py init_storage`
(`backend/apps/core/management/commands/init_storage.py`). The command is
idempotent — safe to re-run at any time.

There is deliberately **no bucket per institutional Site**: all sites share
the platform buckets with object key prefixes (Site scoping arrives with the
Organization/Site stories).

Credentials come from `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` environment
variables (root credentials live only in `.env`, which is gitignored).
The MinIO console is available at http://localhost:9001 in development.
