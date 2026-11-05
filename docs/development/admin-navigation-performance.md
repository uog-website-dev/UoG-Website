# Admin navigation performance

The Site list API includes a read-only `primary_domain` summary (`hostname`,
`status`, or `null`). The list query prefetches primary domains in one additional
query. The admin table renders this summary without a Server Action per row.
The client retains its previous domain lookup for older API responses that omit
the field. Do not send the summary in write payloads.

The platform Domain inventory composes existing permission-checked per-Site
endpoints with at most four concurrent Site reads. Pagination within a Site is
sequential and output retains Site order. A failed read fails the inventory;
partial results are not presented as a complete directory.

The shared `useAsync` hook reuses only the same component's matching in-flight
request during React development effect replay. Completed responses are not
cached. Reloads and dependency changes fetch again; stale responses cannot
overwrite the current result. Include all workspace/filter dependencies when
using the hook. Organization tree reads use this same hook.

`pnpm dev` starts Next through `frontend/apps/admin-web/scripts/dev.mjs`, which
warms the common administration routes with anonymous GET requests. This moves
development compilation to startup; it does not eliminate compilation time.
Wait for `[admin] Common navigation routes warmed.` when measuring navigation.
No credentials or cookies are retained, and authenticated data and permission
checks continue through the existing backend. Production build/start commands
are unchanged.

Local measurements and regression results are recorded in
[the navigation report](../qa/admin-navigation-performance-2026-11-04/report.md).
