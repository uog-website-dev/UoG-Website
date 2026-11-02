# Site navigation editor

Site administrators manage local menus on the Site detail screen and on
`/sites/{id}/admin/menus`. The screen calls only `/api/v1/sites/{that-site}/menus/`
and `/api/v1/sites/{that-site}/menu-inheritance/`. Reordering uses **Move up**
and **Move down** buttons, which are ordinary buttons a keyboard can focus
and activate. There is no drag handle that is mouse-only.

Menu items can be added, edited, nested, reordered and removed. Move up, move
down, nest and move out are buttons a keyboard can focus. Dropping an item on
a sibling reorders that group and sends the current Menu ETag. A Page or Post
target must be one returned for this Site. An external URL must be http or
https, without credentials or a scriptable scheme. A tree cannot nest deeper
than four levels. A stale ETag returns a conflict, the tree reloads, and the
editor does not retry that write.

The list shows each menu's name, header or footer location, active or inactive
status, and ownership:

- **Local** — this Site owns the menu. A user with `menu.write` can create it
  and edit its name and location. Publishing needs `menu.publish`. An active
  menu also needs publish permission before its links change.
- **Central** — the platform owns the menu (`is_global`). It is shown so the
  Site administrator can see it. The screen does not offer edit, reorder, or
  publish controls. The API rejects those changes unless the caller has
  platform-scoped `menu.write`.
- **Inherited** — another Site's local menu. The policy for this Site says
  whether public delivery copies that parent menu and whether it includes the
  central fragment. The parent menu is edited on the owning Site.

A reader with only `menu.read` sees the list, the empty state, and a
permission notice. Create and edit controls stay hidden. A failed load shows
the API error. When MENUS is off, the editor disables create, edit, publish,
add, and reorder. The public endpoint answers 404 and the website shows no
navigation. Rows are not deleted.

The public Next.js site loads `GET /api/v1/site-context/menus/` with no Site
id. The backend chooses the Site from the trusted Host. Header links collapse
into an **Open site header** button on narrow screens; Escape and **Close
site header** dismiss it. Footer links stay in the page. `javascript:`,
`data:` and protocol-relative targets are rendered as text, not links.

Evidence lives in the automated tests:

- `frontend/apps/admin-web/src/sites/menu-items.test.tsx` — keyboard nest and lift, drag reorder, invalid URL, unavailable Page, save, conflict reload
- `frontend/apps/admin-web/src/sites/site-menus.test.tsx` — create, edit, location assignment, ownership, empty and error states, permission, reorder, reload order, Site isolation, disabled module
- `frontend/apps/admin-web/src/sites/menu-paths.test.ts` — menu and inheritance URLs cannot name a second Site
- `frontend/packages/ui/src/site-navigation.test.tsx` — public header/footer, unsafe URLs, mobile menu keyboard
- `backend/apps/cms/tests/test_menu_api.py` — local location edit, cross-site rejection, central-menu authority, disabled module
- `backend/apps/cms/tests/test_menu_delivery.py` — public visibility, inheritance, and the disabled MENUS module
