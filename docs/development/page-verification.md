# Page authoring, review and public delivery

A Site editor creates a draft on the Site detail screen, previews it, and
submits it for review. Approve, publish and unpublish use the same Site's
`/api/v1/sites/{id}/pages/{page}/workflow/` route. **Set as homepage** calls
`/homepage/` and only while the Page is draft or unpublished. Every URL is
built from that Site id.

The public Next.js home page loads `GET /api/v1/site-context/homepage/` with
no Site id. The backend chooses the Site from the trusted Host. A draft,
rejected, unpublished or foreign Page is not rendered. Paragraph HTML is
shown as text plus links whose targets are same-site paths or http(s) URLs.
`javascript:` targets and `<script>` elements are not mounted.

When PAGES is off, create, edit, review, publish and homepage assignment
return `400` with `details.reason` `module_disabled`. The public routes
return 404. Existing rows stay in the database, and the editor can still
list them.

Evidence:

- `frontend/apps/admin-web/src/sites/site-pages.test.tsx` — submit, homepage, Site isolation, disabled module, keyboard focus, unsafe preview
- `frontend/apps/admin-web/src/sites/page-paths.test.ts` — Page URLs name one Site
- `frontend/packages/ui/src/public-page.test.tsx` — published page, XSS, keyboard link, empty delivery
- `backend/apps/cms/tests/test_page_api.py` — authoring, homepage, rejection, cross-site 404, module gate, public host scope
