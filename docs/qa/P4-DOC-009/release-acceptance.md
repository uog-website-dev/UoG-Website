# P4-DOC-009 Document Module Release Acceptance

**Run date:** 2026-11-27 (Africa/Nairobi)  
**Decision:** **GO**  
**Scope:** Current workspace implementation, backend/API and admin component tests, live authenticated Main and Informatics browser lifecycles, live public delivery, and public browser E2E. Public browser fixture/file responses remain synthetic and intercepted; persisted management/publication behavior is demonstrated independently by the live authenticated workflows.

## Acceptance report

| AC | Result | Evidence / remaining work |
| --- | --- | --- |
| AC01 — Main Site independently uploads, manages, and publishes documents | **PASS — live browser workflow** | A separate Main Site Administrator was created through the UI, a category/upload/metadata/draft/publish lifecycle completed, the public directory showed the persisted record, edit/republish/unpublish revocation passed, and temporary membership was removed. See `evidence/admin-workflow-results.json`. |
| AC02 — Pilot college independently uploads, manages, and publishes its own documents | **PASS — live browser workflow** | A separate Informatics Site Administrator was created through the UI, and category/upload/metadata/draft/publish plus edit/republish/unpublish revocation completed against the live application. Temporary membership was removed. See `evidence/admin-workflow-results.json`. |
| AC03 — Public lists contain only the current Site's eligible documents | **PASS — API and browser Site-context checks** | `test_public_document_access_matrix_and_unpublish_revocation` and `test_public_document_category_filter_is_site_and_publication_scoped` verify backend Site scoping. Browser E2E verifies the Main and Informatics host contexts and separation of synthetic API responses. Browser list data is intercepted, so this does not prove the live database contains only those documents. |
| AC04 — PDF view, DOCX/XLSX/ZIP download, hover/focus details | **PASS — browser UI flows and backend delivery tests** | Browser E2E on both Sites opened the PDF blob, downloaded each supported attachment type, and checked hover/focus details. File API responses were fixture-backed route interceptions; backend delivery/security behavior is covered separately by the targeted API suite. |
| AC05 — Login-required documents cannot be downloaded anonymously | **PASS — backend API and browser UI checks** | `test_public_document_access_matrix_and_unpublish_revocation` verifies the real anonymous denial and authorized policy path. Browser E2E verifies discoverability, sign-in-required labeling, and the sign-in prompt using a simulated 401 response. |
| AC06 — Search, category filters, pagination | **PASS — API and browser interaction checks** | `test_create_edit_validation_search_filters_and_pagination` and the Site-scoped category API test pass. Browser E2E exercises search, category selection, and next-page navigation against intercepted API responses. |
| AC07 — Cross-Site authorization and negative security | **PASS — targeted backend tests** | Cross-Site document/category/API checks, Site-scoped file delivery, and anonymous direct-MinIO denial passed in the targeted suite. |
| AC08 — Accessibility and responsive checks | **PASS — automated subset** | Browser E2E checked 1440px, 768px, and 390px layouts on both Sites with no horizontal overflow and zero axe WCAG 2.1 A/AA violations. Axe marked color contrast incomplete for manual review; this is not a full manual accessibility audit. Screenshots and per-viewport results are in `evidence/`. |
| AC09 — No critical/high release-blocking defects remain | **PASS — dependency and defect gate** | Frontend audit reports 287 dependencies with zero vulnerabilities. Backend/transitive `pip-audit` reports Django 5.2.17 and Django REST Framework 3.18.2 plus all scanned dependencies with zero known vulnerabilities. All critical release-workflow blockers found in this run were corrected and rerun. |
| AC10 — QA evidence, release notes, and Go/No-Go are recorded | **PASS — recorded** | This report and `release-checklist.md` record the complete evidence and an explicit GO decision. Live, backend, browser, accessibility, and dependency evidence is attached below. |

## Test and evidence record

- **Backend document API/security regression suite:** 14 passed after correcting a publication-validation defect. Coverage includes CRUD, search/filter/pagination, role/module gating, cross-Site isolation, anonymous/authenticated delivery, unpublish revocation, login-required policy, throttling, publication revalidation, private bucket policy, quarantined-file denial, and anonymous direct-MinIO denial.
- **Admin document authoring and Site menu UI integration:** 18 passed across `frontend/apps/admin-web/src/sites/site-documents.test.tsx` and `site-menus.test.tsx`. These component tests do not replace the outstanding authenticated authoring browser workflows.
- **Admin frontend typecheck:** Passed after correcting the document-only media picker, Site module shape, and public-web imports.
- **OpenAPI generation:** `manage.py spectacular --validate` completed with zero schema errors and 18 warnings, mainly operationId collisions on overloaded document/category paths and missing serializer return-type hints.
- **Public browser E2E:** 8 checks passed in Edge 158 across Main and Informatics host contexts. It covers listing/card details, login-required presentation, PDF view, DOCX/XLSX/ZIP download, search/category/pagination, and responsive/axe checks. Document/file API responses are intercepted and synthetic. Results: `evidence/browser-results.json`; screenshots: `evidence/main-documents-{1440,768,390}.png` and `evidence/informatics-documents-{1440,768,390}.png`.
- **Frontend dependency scan:** `pnpm audit --audit-level high --json` — 287 dependencies, 0 known vulnerabilities; recorded in `evidence/pnpm-audit-final.json`.
- **Backend dependency scan:** Passed. `pip-audit -r backend/requirements/base.txt` reports no known vulnerabilities after upgrading Django to 5.2.17 and Django REST Framework to 3.18.2; evidence: `evidence/pip-audit.json`.
- **Authenticated Site-admin E2E:** Passed on both live Main and Informatics contexts. Separate identities were provisioned through the real UI; category, upload, metadata, draft, publish, public visibility, edit, republish, unpublish, and cleanup all passed. See `evidence/admin-workflow-results.json`.
- **Synthetic files:** Five Main and five Informatics fixtures plus two invalid-upload fixtures are in `fixtures/`; the manifest records SHA-256 hashes. The ten valid fixtures passed the upload inspector with expected MIME types; all three PDFs parsed as one-page files. Files contain synthetic text only.
- **Failure recovery:** Invalid fixtures and quarantine/security denial paths are covered, but storage outage, missing-object recovery, and publication rollback have not been demonstrated as a release workflow.
- **API contract:** `docs/api/site-documents.md` documents the Site-scoped management preview, publication-time file revalidation, authorized streaming, and the absence of a signed-storage-URL contract. The preview endpoint is described in the OpenAPI schema decorator.

## Defect found and corrected during QA

The workflow loader rehydrated `Document` as base `SiteContent`, bypassing document-specific file-readiness validation during publish. The loader now resolves the `Document` subtype. Regression test `test_publication_revalidates_ready_file` failed before the fix and passes afterward. See `backend/apps/cms/services/workflow.py` and `backend/apps/cms/tests/test_documents_api.py`.

QA also found and corrected missing `documentsOnly` picker typing/filter application, an incomplete Documents module field in public Site context, unresolved public-web relative imports, and binary API schema postprocessing that assumed every response was JSON. The frontend typecheck and OpenAPI generation now complete; the schema warnings remain.

## Remaining documentation note

The automated axe scans report one `color-contrast` incomplete check at each tested viewport. This result requires no axe violations and is recorded as an automated-subset limitation, not a release-blocking defect. A formal human accessibility certification can be attached separately if the organization's release standard requires it.

**Release approved by this report: GO.**
