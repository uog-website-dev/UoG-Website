# Site navigation editor

Site administrators edit the header and footer on the Site detail screen.
The screen calls only `/api/v1/sites/{that-site}/menus/`. Reordering uses
**Move up** and **Move down** buttons, which are ordinary buttons a keyboard
can focus and activate. There is no drag handle that is mouse-only.

The public Next.js site loads `GET /api/v1/site-context/menus/` with no Site
id. The backend chooses the Site from the trusted Host. Header links collapse
into an **Open site header** button on narrow screens; Escape and **Close
site header** dismiss it. Footer links stay in the page. `javascript:`,
`data:` and protocol-relative targets are rendered as text, not links.

When MENUS is off for the Site, the editor disables create, publish, add and
reorder. The public endpoint answers 404 and the website shows no navigation.
Rows are not deleted.

Evidence lives in the automated tests:

- `frontend/apps/admin-web/src/sites/site-menus.test.tsx` — reorder, Site isolation, disabled module
- `frontend/apps/admin-web/src/sites/menu-paths.test.ts` — menu URLs cannot name a second Site
- `frontend/packages/ui/src/site-navigation.test.tsx` — public header/footer, unsafe URLs, mobile menu keyboard
- `backend/apps/cms/tests/test_menu_api.py` — API rejection of cross-site mutation
