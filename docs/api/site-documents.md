# Site Documents API

Document management is mounted under `/api/v1/sites/{site_id}/documents/` and uses the existing bearer authentication, Site CMS roles, and the `DOCUMENTS` module gate (which requires `MEDIA`). All document reads and writes are scoped to the Site in the URL.

| Method and path | Purpose |
| --- | --- |
| `GET /documents/` | Paginated list; accepts `search`, `category`, `status`, `file_type`, `visibility`, `page`, and `page_size` |
| `POST /documents/` | Create a Draft; title, file reference, sanitized description, category IDs, version, effective date, and access settings are accepted |
| `GET /documents/{uuid}/` | Retrieve one Site-owned document |
| `PATCH /documents/{uuid}/` | Update editable fields while preserving the content UUID and revision/publication history |
| `DELETE /documents/{uuid}/` | Site Administrator deletion through the CMS retention and audit hooks |
| `GET /documents/categories/` | List active Site-owned document categories |
| `POST /documents/categories/` | Add a document taxonomy category as a Site Administrator |
| `GET /documents/categories/{uuid}/` | Retrieve a category within the selected Site |
| `PATCH /documents/categories/{uuid}/` | Rename, reorder, describe, or activate/deactivate a category without breaking document links |
| `DELETE /documents/categories/{uuid}/` | Delete an unused category; returns a validation error while documents reference it |
| `POST /documents/{uuid}/publish/` | Publish through the CMS workflow |
| `POST /documents/{uuid}/unpublish/` | Unpublish through the CMS workflow |

The description accepts sanitized HTML using paragraphs, bold, italic, underline, ordered and unordered lists, and safe links. Unsafe tags, attributes, and link schemes are removed server-side. `version` defaults to the empty string and `effective_date` defaults to `null`; dates use ISO `YYYY-MM-DD`. `visible_to_public` defaults to `true` (legacy `visibility` is kept in sync), while `require_login_to_download` defaults to `false`. Only a Site Publisher can publish or unpublish; authorization is checked on every workflow request.

Document uploads use the existing Media Library multipart endpoint. The document `file_reference` is the opaque Site asset identifier returned by the media API (`sites/{site_id}/assets/{asset_uuid}`), never a MinIO path. The media API enforces type, size, Site ownership, and processing readiness. Upload/download contracts are described in [media-uploads.md](media-uploads.md).

Categories reuse the shared `api.Category` taxonomy model with `kind=DOCUMENTS`; the existing `/categories/` API remains reserved for Post categories. Names and active slugs follow the shared Site and locale uniqueness rules. Category deletion is blocked while linked documents exist; deactivation retains links and existing documents. The public Documents & Files page is available at `/documents`. Public metadata is available at `/api/v1/site-context/documents/` with `search` (title), `category` slug, `file_type` (`pdf`, `docx`, `xlsx`, `zip`), `page`, and `page_size`. Invalid filters and page values return validation errors; valid but unknown categories return no results. `/documents/categories/` returns active document categories configured for the current Site. Both endpoints resolve Site ownership from the trusted host and honor the `DOCUMENTS` module gate. The listing includes only published, public documents whose Site-owned file passed scanning and does not return storage references or object keys. Public file delivery uses `/api/v1/site-context/documents/{uuid}/file/`, performs a live publication/visibility/scan check, and streams the verified object with `Cache-Control: private, no-store`; it does not issue cacheable signed URLs. The public frontend proxies downloads and forwards a signed-in visitor's Keycloak access token without exposing it to browser JavaScript. Login-required public documents remain discoverable but return `401` to anonymous download requests. Documents with `visible_to_public=false`, or Draft/Unpublished documents, are hidden and return `404` even to authenticated visitors; the login toggle alone never makes private content accessible.

Responses include the immutable content UUID, current status, revision number, publication timestamp, effective date, visibility, categories, original filename, detected MIME type, and byte size. Drafts are created by default. Empty titles and files that are foreign, unsupported, unavailable, or awaiting required security processing are rejected with field-level validation errors.
