# Site media browse verification — 2026-11-11

Site Editors can browse the active Site media library inside Site
Administration with grid/list layouts, search, filters, pagination,
thumbnails, and explicit loading, empty and error recovery. Catalog queries
are Site-scoped; switching Sites remounts the library so filters and stale
responses cannot leak across Sites.

## Contracts and implementation

- [Browse behaviour in the upload/library contract](../../architecture/media-uploads.md)
- [Site Administration Media section](../../../frontend/apps/admin-web/src/sites/site-admin.ts) (`MEDIA` module + `content.media.view`)
- [Media page](../../../frontend/apps/admin-web/src/app/sites/[id]/admin/media/page.tsx) and [dashboard card](../../../frontend/apps/admin-web/src/sites/site-dashboard.tsx)
- [Library UI](../../../frontend/apps/admin-web/src/sites/media-library.tsx) (`key={siteId}` remount + `useAsync` ignore-stale)
- [Browser fixture](../../../frontend/apps/admin-web/qa/media-library/) (Informatics ↔ Medicine Site switch)
- [Component / stale-request tests](../../../frontend/apps/admin-web/src/sites/media-library.test.tsx)

## Results

| Verification | Result | Evidence |
| --- | --- | --- |
| Library + Site admin matrix | 25 passed | [JUnit](library.xml) |
| Stale Informatics search after Medicine switch | PASS — delayed Site 11 response ignored; only Medicine asset remains | `ignores a delayed Informatics search after switching to Medicine and resets all query state` in [library.xml](library.xml) |
| Empty search + transport failure recovery | PASS — Show all media / Retry media | [library.xml](library.xml) |
| Keyboard recovery actions | PASS — Enter on Show all media; Space on Retry media | [library.xml](library.xml) |
| Keyboard pagination and grid/list | PASS — Enter/Space on Next/Previous and layout toggles | [library.xml](library.xml) |
| Responsive grid/list shells | PASS — CSS grid list + list layout toggle | [library.xml](library.xml) |
| Editor Media section gate | PASS — visible only with MEDIA + `content.media.view` | `shows Media for a Site Editor when MEDIA is enabled…` in [library.xml](library.xml) |

## Acceptance mapping

| Criterion | Status | Notes |
| --- | --- | --- |
| Switching Sites updates catalog/filters without old Site results | **PASS** | Remount clears search; delayed Informatics payload never renders on Medicine |
| Retry/empty states offer next action; keyboard usable | **PASS** | Retry media, Show all media / Check for media; keyboard pagination and layout |
| Informatics image never appears when switching to Medicine | **PASS** | Client filter `asset.site === siteId` + remount + ignored stale completion |

Advanced Slider/Gallery builder browser regression remains unavailable in this
checkout; Page editor picker and portal regressions are covered by adjacent
media stories. The dedicated browse fixture under
`frontend/apps/admin-web/qa/media-library` builds to
`frontend/dist/media-library-qa/` for Informatics ↔ Medicine Site-switch and
responsive review. Build with `node build.mjs`, then serve with
`node server.mjs` (Site 11 searches are delayed so a late Informatics
response can be raced against a Medicine switch).

## Machine-readable summary

See [verification.json](verification.json).
