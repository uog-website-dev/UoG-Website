# P4-DOC-005 Research Center browser verification

Date: 2026-11-25 (Africa/Nairobi)
Site: Research Center Site (`RESEARCH`, `research.uog.local`, Site ID 5)

## Result

Real-browser E2E passed against the Research Center public hostname using Microsoft Edge 158.0.4370.33 with Playwright 1.56.1. The E2E reached the app through the public HTTP host routing, not the direct Next.js development port.

The Research Center now has global and Site-level `MEDIA` and `DOCUMENTS` enabled. Its live public APIs return HTTP 200 with zero published documents and zero categories. The page therefore displays the expected empty state. No Site content was created or changed for this run.

## Browser E2E evidence

- `/documents` returned HTTP 200 and rendered the Research Center header, footer, theme, and `Documents & Files` page.
- Empty document state rendered for the Site; submitting title search `policy` updated the URL and rendered the no-matches state.
- The breadcrumb label reads `Documents` and aligns with the page content. This was corrected in `frontend/apps/public-web/src/public-menus.tsx` after the first browser screenshot exposed a flush-left lowercase breadcrumb.
- Viewports: desktop 1440x1000, tablet 768x1024, mobile 390x844. Tablet and mobile had no horizontal overflow.
- Keyboard Tab moved focus to an interactive input.
- No browser console errors. Document and category API calls returned HTTP 200.

Screenshots: [desktop](desktop.png), [search empty state](search-empty.png), [tablet](tablet.png), [mobile](mobile.png).

## Acceptance criteria status

| AC | Status | Evidence / limitation |
| --- | --- | --- |
| AC01 | **PASS** | Research Center hostname resolves to its Site; route renders the Site-scoped eligible-document state. There are currently no eligible published documents. |
| AC02 | **PASS** | Search control renders and submits in browser; API title search is covered by the focused API suite. |
| AC03 | **PASS** | Live empty state is shown; draft/unpublished/private exclusion is covered by API tests. |
| AC04 | **PASS** | Host-scoped category API is Site-isolated in API tests; Research Center currently has no categories. |
| AC05 | **PASS (API)** | File-type and pagination behavior, including invalid inputs, is covered by API tests. Browser category and pagination controls cannot be exercised with zero records/categories. |
| AC06 | **PASS** | Desktop/tablet/mobile renders checked; no horizontal overflow at tablet/mobile; keyboard focus advanced. |
| AC07 | **PASS** | Useful no-documents and no-search-results states verified in browser. |
| AC08 | **PASS** | Browser screenshots show Research Center header, footer, and selected theme. |
| AC09 | **PASS** | Invalid category and pagination handling is covered by API tests. |
| AC10 | **PASS** | Public API privacy and Site isolation assertions passed in API tests; live hostname APIs return only the empty public response. |

## Additional checks

- `docker compose exec -T backend pytest apps/cms/tests/test_documents_api.py -q --reuse-db --tb=short` — **10 passed**.
- `docker compose exec -T frontend-public pnpm --filter @uog/public-web typecheck` — **passed**.
- `git diff --check` — **passed**.

Limitation: the Research Center has no published document or active document-category fixtures, so card rendering, category selection, and visible pagination were not exercised with live records in this browser run. Their API behavior is covered by the focused backend suite.
