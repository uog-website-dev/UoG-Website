# Header menus in the first response

P4-F-CHROME: navigation must be available immediately. Previously the layout
rendered branding and search, then `PublicMenus` fetched menus after hydration
and the navigation appeared later, shifting the header.

## Rendering

`apps/public-web/src/app/layout.tsx` resolves the Site from the trusted Host,
then resolves that Site's menus on the server:

1. `publicSiteForHost(host)` → Site context (`GET /api/v1/site-context/`).
2. `publicMenusForHost(host, site.id)` → `GET /api/v1/site-context/menus/`,
   called only when the Site's `MENUS` module is enabled.
3. The raw payload is passed through `PublicSiteChrome` to `PublicMenus`, whose
   `useState` initializer parses it with `menusFromResponse`. Because client
   components are server-rendered, the header, utility navigation and footer
   are in the initial HTML.

After hydration the parsed state is unchanged, so the DOM and focus order do
not change. The client does not repeat the initial request when the server
already supplied this Site's payload; focus/visibility refreshes remain for
open tabs after a menu publication.

## Site isolation and caching

- `menuPayloadForSite(payload, siteId)` accepts a payload only when
  `payload.site` strictly equals the Site id resolved for the request, and
  `locations` is an object. Any other payload becomes no navigation.
- `publicMenusForHost` is wrapped in React `cache`, keyed by **Host and Site
  id**. It is request-scoped, so it cannot serve Site A's menus to Site B or
  outlive a publication. There is no process-wide Next.js copy of menus.
- The backend remains the delivery cache owner. `_cached_location` keys entries
  by Site, location and `delivery_version`, and the publish/unpublish workflow
  bumps that version. The response is `Cache-Control: public, max-age=0,
  must-revalidate` with `Vary: Host`.

## Failure behaviour

| Condition | Result |
| --- | --- |
| `MENUS` disabled | No server menu request; no navigation. |
| Menu endpoint 404 / unknown Host | `null` payload; no navigation, no error UI. |
| Payload for another Site | Rejected by `menuPayloadForSite`; no navigation. |
| Backend unreachable | `null` payload; no navigation. |

Link safety and inheritance are unchanged: the server payload goes through the
existing `menusFromResponse` → `safeMenuHref` normalization, and the backend
still composes global, inherited and local menus.

## Evidence

- Initial HTML (`curl http://aau-review.localhost/`) contains 7
  `data-nav-index` nodes and 4 footer groups; `http://localhost/` (Main Site)
  contains 7 header nodes and 3 footer groups.
- Hydrated DOM has the same 7 header nodes at 390 px; header is 70.4 px, footer
  816.2 px collapsed.
- Browser load of `/posts` after the change: 0 client requests to
  `/api/v1/site-context/menus/`, 0 client requests to `/api/v1/site-context/`,
  `layout-shift` entries 0 and CLS 0 (Performance API), header height 70.4 px.
- Main vs child isolation: child HTML contains no `Main Navigation`; Main HTML
  contains no `Latest news` child menu label.
- `MENUS` disabled Host (`article-media-post-...uog.local`) returns 404 from
  the menu endpoint → the layout renders no navigation.
- Tests: `test_menu_delivery.py` covers publish/unpublish invalidation and
  per-Site/location cache invalidation; `public-site.test.tsx` covers payload
  Site matching and malformed/absent payloads.

### Not covered in this environment

- No published-menu change was made against live data to observe an open tab
  refresh; cache invalidation is covered by backend tests and focus refresh.
- CLS was read from the Performance API for `/posts`; the homepage returns no
  page content in this dev Site, so a hero/image CLS sequence was not measured.
- Authenticated admin visual regression was not run (no Keycloak session).
