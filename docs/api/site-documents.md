# Site Documents API

Document management is mounted under `/api/v1/sites/{site_id}/documents/` and uses the existing bearer authentication, Site CMS roles, and the `DOCUMENTS` module gate (which requires `MEDIA`). All document reads and writes are scoped to the Site in the URL.

| Method and path | Purpose |
| --- | --- |
| `GET /documents/` | Paginated list; accepts `search`, `category`, `status`, `file_type`, `visibility`, `page`, and `page_size` |
| `POST /documents/` | Create a Draft; title, file reference, description, category IDs, version, effective date, and visibility are accepted |
| `GET /documents/{uuid}/` | Retrieve one Site-owned document |
| `PATCH /documents/{uuid}/` | Update editable fields while preserving the content UUID and revision/publication history |
| `DELETE /documents/{uuid}/` | Site Administrator deletion through the CMS retention and audit hooks |
| `GET /documents/categories/` | List active Site-owned document categories |
| `POST /documents/categories/` | Add a category as a Site Editor or Administrator |
| `POST /documents/{uuid}/publish/` | Publish through the CMS workflow |
| `POST /documents/{uuid}/unpublish/` | Unpublish through the CMS workflow |

Document uploads use the existing Media Library multipart endpoint. The document `file_reference` is the opaque Site asset identifier returned by the media API (`sites/{site_id}/assets/{asset_uuid}`), never a MinIO path. The media API enforces type, size, Site ownership, and processing readiness. Upload/download contracts are described in [media-uploads.md](media-uploads.md).

Responses include the immutable content UUID, current status, revision number, publication timestamp, effective date, visibility, categories, original filename, detected MIME type, and byte size. Drafts are created by default. Empty titles and files that are foreign, unsupported, unavailable, or awaiting required security processing are rejected with field-level validation errors.
