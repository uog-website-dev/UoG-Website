# P4-DOC-006 — Pass/Fail Report

Date: 2026-11-25 (Africa/Nairobi)
Browser site: Research Center Site (`research.uog.local`, Site ID 5)

## Acceptance criteria

| AC | Result | Evidence |
| --- | --- | --- |
| AC01 | **PASS** | Edge browser hover revealed description, category, version, effective date, file type, and file size. |
| AC02 | **PASS** | Focusing the card controls reveals the same details; keyboard activation opens the PDF action. |
| AC03 | **PASS** | On a touch-emulated mobile viewport, the Details control expands the complete metadata panel. |
| AC04 | **PASS** | PDF action calls the authorized endpoint with `inline=1`, opens a separate tab with `window.opener === null`, and displays the PDF response. Backend test verifies `application/pdf` and `Content-Disposition: inline`. |
| AC05 | **PASS** | Edge E2E observed downloads with `.docx`, `.xlsx`, and `.zip` filenames. The real backend integration test verifies a scanned DOCX response uses its detected MIME and `Content-Disposition: attachment`, even if `inline=1` is requested. |
| AC06 | **PASS** | Anonymous access to a login-required file returns 401; UI displays a Sign in link. Direct file API test verifies denial. |
| AC07 | **PASS** | Authenticated eligible API client retrieves the login-required file successfully (200). |
| AC08 | **PASS** | Removed storage object and quarantined/unavailable file cases return 404; browser displays a clear accessible error for unavailable files. |
| AC09 | **PASS** | Backend responses use private no-store caching, `nosniff`, noindex, the detected MIME, and safe disposition. The proxy only forwards safe response headers and keeps the bearer token server-side. |
| AC10 | **PASS** | Browser E2E verified hover, keyboard, touch, PDF/download actions, and error behavior. Focus and touch details remain keyboard accessible. |

## Verification run

- Real Edge 158 browser E2E via Playwright 1.56.1 against the Research Center hostname: **PASS**.
- Browser fixture paths covered hover/focus/touch, PDF preview and fallback, DOCX/XLSX/ZIP downloads, pagination, anonymous login-required denial, and missing-file errors. The Site's real shell/context was used; document and file payloads were intercepted as controlled fixtures because Research Center has no published documents/categories.
- `docker compose exec -T backend pytest apps/cms/tests/test_documents_api.py -q --reuse-db --tb=short` — **10 passed**.
- `docker compose exec -T frontend-public pnpm --filter @uog/public-web typecheck` — **passed**.
- `git diff --check` — **passed**.

Screenshots: [desktop hover](evidence/desktop-hover.png), [mobile details](evidence/mobile-details.png).

## Audit note

Document publication and revision changes continue through the existing audit lifecycle. Repository policy/docs do not specify a separate per-download audit event requirement; no new file-access/IP tracking was added, to avoid introducing unapproved visitor activity logging.
