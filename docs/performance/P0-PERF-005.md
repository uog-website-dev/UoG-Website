# P0-PERF-005: Section navigation

PERF-003/004 already put workspace, Pages, Posts, Menus, Media, taxonomy, dashboard summaries and menu locations on one scoped TanStack Query client. The shared shell stays above section routes; the workspace bootstrap is shared rather than fetched by each page. This change restores the controls selecting those cached queries and adds bounded navigation intent prefetching. There is no second content cache or new backend API.

## Navigation state

`useSectionState` stores only read-navigation controls under the existing key convention: session identity, Site, authorization fingerprint, `section-state`, section and field. It uses the same five-minute inactive GC and memory-only lifecycle as the query client. Controlled inputs update synchronously in React; their next mount restores from that scoped entry. No localStorage, sessionStorage, URL secrets or persisted cache is introduced.

| Section | Restored controls | Always local/reset |
| --- | --- | --- |
| Pages / Builder directory | Applied and editable search/status filters, sort, page, review queue; separate directory namespaces | Workflow dialogs, comments, previews, Page drafts |
| Posts | Applied and editable search/status/category/tag filters, sort, page | Workflow dialogs, article text, editor metadata |
| Menus | Directory search and selected stable menu ID | New-menu fields, rename/item/reorder drafts, dialogs |
| Media | Applied filters, search/status/type controls, page, grid/list view; image-only namespace separate | Picker controls, uploads, metadata edits, selection, preview/dialog state |

Site B never inherits A's filters. A return to A can restore A's own navigation controls subject to its authorization namespace and cache lifetime. Role/module changes purge obsolete controls together with protected queries; logout/session change clears the client. Content mutations invalidate only their existing domain families and preserve controls. A deleted/missing selected menu uses the directory's existing fallback. An explicit DRF `404 Invalid page.` for a retained page greater than one returns to page one; permission, transport and ordinary not-found errors keep their existing error handling.

## Selective prefetch

Inactive Pages, Posts, Menus and Media rail links use explicit pointer/focus intent rather than automatic viewport prefetch. Short intent cancels on leave/blur. After **180 ms**, one shared client scheduler permits at most one start per **second**, with the same route deduplicated for thirty seconds. Hidden/offline, Save-Data and slow-2g/2g contexts skip speculation. Scope change or unmount cancels pending intent.

The scheduler checks the live cached workspace's Site, current permissions/modules and original thirty-second authorization lease before invoking Next route prefetch. Only the approved lightweight **Page status counts** are warmed as data, and only with `content.pages.view` and PAGES enabled. They use the exact existing `page-counts` query, so a concurrent Page/dashboard consumer shares the pending read. No Post bodies, menus/items, media bytes, draft/revision records, list pages or foreign Sites are speculatively fetched. Backend authorization remains authoritative.

## Loading, freshness and delivery

Existing query readers still show skeletons only with no usable data, preserve valid rows during background refresh and expose refresh/error/retry controls. Authorization failure hides protected rows. Existing scoped write receipts, conflict handling, draft guards and late-write navigation guards remain intact.

Private thumbnail delivery intentionally retains its existing `private, no-store` policy. A Media return can revalidate image bytes even when its metadata/list needs no RPC. Those delivery calls are distinguished from redundant list/context reads in the evidence. This work does not introduce a browser blob cache or relax asset eligibility checks to improve a benchmark.

## Reproduction

```powershell
./scripts/perf/run.ps1 -Mode production -Samples 10 -Sites 21 -SectionMatrix -Output docs/qa/P0-PERF-005/local
```

The optional matrix adds ten cached-return measurements for each of Pages, Posts, Menus and Media to the existing production baseline. Each return has browser network counts/bytes/waterfalls and correlated Django/Next/SQL traces. `scripts/perf/section-check.cjs` separately verifies restored filtered/sorted/paged lists and the persistent shell; `cache-check.cjs` verifies mutation freshness and logout. Pipe the private session helper directly to the browser script, never to a saved evidence file.

See [verification evidence](../qa/P0-PERF-005/2026-11-16/README.md). Targets and methodology remain proposed until product/QA approval: cached section return <=300 ms and cached transition <=500 ms under PERF-001 conditions. No Django schema migration is required; deploy the rebuilt admin service.
