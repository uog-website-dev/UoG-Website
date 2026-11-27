# P4-DOC-008 Document Access Control Review

**Review date:** 2026-11-26  
**Result:** **PASS** for AC01–AC10, based on the targeted backend, UI, and live MinIO checks below.  
**Scope:** Current workspace implementation; public delivery streams through the Site API and Next proxy. No signed download URLs are issued.

## Acceptance criteria

| Criterion | Result | Evidence |
| --- | --- | --- |
| AC01: Anonymous access to a published public document | **PASS** | `test_public_document_access_matrix_and_unpublish_revocation` streams a published PDF to an anonymous client. |
| AC02: Anonymous access denied for login-required files | **PASS** | The same test asserts HTTP 401 for the login-required document. |
| AC03: Authenticated eligible user can access login-required file | **PASS** | An active authenticated Site author receives the file; the policy grants access to an active authenticated account when the document requires login. |
| AC04: Copied URL stops working after unpublish | **PASS** | The test unpublishes the document, then asserts 404 and `Cache-Control: private, no-store, max-age=0` on the copied URL. Every request rechecks current database state. |
| AC05: Private document IDOR is denied | **PASS** | Hidden and draft document URLs return 404. A Site B document identifier requested on Site A's public host returns 404. |
| AC06: Site A permissions cannot preview Site B documents | **PASS** | The Site A author receives 403 on the Site B management file route. The management preview checks the document's Site and a live CMS role grant. |
| AC07: Storage keys and credentials are not exposed publicly | **PASS** | Public list serialization omits `storage_reference`, `file_reference`, and Site identifiers. Delivery URLs are application routes; no storage URL or credentials are returned. |
| AC08: Revocation and expiry behavior | **PASS** | The platform does not mint signed URLs. It streams after live authorization on each request; unpublish revokes the application URL immediately and responses are non-cacheable. |
| AC09: Documents module disablement blocks access | **PASS** | The API test asserts list, public file, and management file paths return 404 after disabling DOCUMENTS. |
| AC10: Security events and downloads are audited safely | **PASS** | Successful deliveries emit `DOCUMENT_FILE_DELIVERED`; denied access emits `DOCUMENT_FILE_ACCESS_DENIED`. Tested audit snapshots contain only Site/reason or Site/MIME fields, with no token, object key, or filename. |

## Authorization matrix

| Operation | Required authority |
| --- | --- |
| Read/preview document metadata or management file | Site CMS role with document-read access or platform administrator |
| Create/update | Site CMS author/editor role or Site Administrator |
| Publish/unpublish | Site publisher role or Site Administrator |
| Delete documents and manage categories | Site Administrator or platform administrator |
| Public file delivery | Published, current-Site, PUBLIC and visible document; active login when required; READY, non-deleted, scanned Site asset |
| Generic media download of a document asset | Denied; document files must use the centralized document authorization service |

Public and management inline/attachment requests share `apps/cms/services/document_access.py`. The generic MediaAsset download path rejects assets currently or historically referenced as document files. The public file response is streamed from `platform-private` or `platform-documents`, sets safe MIME/disposition, CSP, nosniff, same-origin, and no-store headers, rejects unknown or repeated query parameters, and uses a Site-wide caller throttle of 60 deliveries per hour with trusted-proxy-aware client identity. MinIO bootstrap resets private bucket ACLs and removes any anonymous bucket policy.

## Verification

- Backend targeted suite: **14 passed** across `apps/cms/tests/test_documents_api.py`, `apps/core/tests/test_document_storage_policy.py`, `tests/test_media_uploads.py::test_document_download_remains_quarantined_until_worker_validation`, and `tests/test_media_assets.py::test_private_document_object_rejects_anonymous_minio_get`.
- Live MinIO direct-access check: uploaded an existing object to `platform-documents`; an unsigned HTTP GET received 403.
- UI: `site-documents.test.tsx` — **4 passed**, including hiding Preview without `content.documents.view` and hiding publish controls from view-only users. Direct create/edit routes are also gated by their matching permissions.
- Admin/public frontend typecheck — passed.
- Python compile check and `git diff --check` — passed.
- MinIO initializer was rebuilt and run against the local instance; it reported both `platform-private` and `platform-documents` as private.

## Notes

The signed-URL expiry case is not applicable because no signed document URLs are created. Application links are revocable routes, checked against publication, visibility, module, Site and file status on every request. The recorded checks are targeted security and integration tests, not a separate third-party vulnerability assessment.



