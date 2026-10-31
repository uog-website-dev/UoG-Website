# Site administration in the shared console

Each Site is administered at `/admin/sites/{id}/admin` in the same admin-web
application. There is not a separate deployment per Site.

The Site selector is filled from the site list the API already limits to
sites the signed-in user may view. Choosing another Site opens
`/sites/{id}/admin`, which remounts the workspace so a draft form does not
carry over.

The site menu shows Dashboard always. Pages, Posts and Menus appear only
when that Site has the matching module enabled and the user's effective
permissions for that Site include one of the section's codes. A direct URL
to a hidden section shows a warning and does not mount the editor. The Page,
Menu and module APIs still enforce the same limits on their own.

Central module activation is the platform registry at `/modules`. It requires
`platform.sites.manage_registry`. A Site administrator does not see that
screen or a link to it unless the permission is delegated. The site menu
says that activation stays in platform administration.

`GET /api/v1/sites/{id}/modules/` includes `module_code` so this screen can
tell PAGES, POSTS and MENUS apart without opening the central registry.

Evidence:

- `frontend/apps/admin-web/src/sites/site-admin.test.ts` — role and module matrix, Site switch target, central permission
- `frontend/apps/admin-web/src/sites/site-admin-frame.test.tsx` — selector, direct URL, draft reset, keyboard menu
- `frontend/apps/admin-web/src/navigation.test.ts` — central Modules entry requires registry authority
