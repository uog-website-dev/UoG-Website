# P0-PERF-003: protected administration query cache

## One mechanism and lifecycle

The admin uses **TanStack Query 5.107.1**, pinned in the workspace lockfile. `AdminQueryProvider` owns one in-memory `QueryClient` for an authenticated Site visit. `WorkspaceProvider` and section readers use that same client. There is no module-level data client, browser-storage persister, service-worker data cache or server-wide user query cache. React StrictMode replay and cancellation are covered by integration tests.

Client defaults are **30 seconds stale time, five minutes inactive garbage collection, no automatic error retries**, and stale background refresh on mount, focus and reconnect. Stale time marks data eligible for refresh; it is not a hard expiration that blanks otherwise valid data. Explicit refresh remains available. A cached entry renders immediately while a refresh is in flight. Transient refresh failure retains previously loaded rows with an error/retry affordance. A Site/user/authorization change is stricter and removes the old protected entries.

Server rendering creates a request-local client without garbage-collection timers; section data is not prefetched or dehydrated into a shared server cache. `QueryClientProvider` then owns the browser lifecycle. See the [official defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults) and [invalidation contract](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation).

## Keys and isolation

`queryKey` is the only key factory:

```text
["admin", sessionPartition, siteId, authorizationFingerprint, resource, params]
```

The session partition is a random non-credential nonce created at sign-in and kept through token refresh. Existing sessions use a server HMAC of subject/issued-at until they next sign in. Access, refresh and ID tokens remain in the encrypted httpOnly session; none are query keys, browser props or invalidation hints. Missing identity fails closed. The authenticated Next workspace proxy attaches the matching `cacheIdentity`; an account-change response cannot be adopted into the old session's cache.

The authorization fingerprint contains the canonical bootstrap's platform/Site permissions, available module codes and Site status. Display-name, locale and homepage changes do not masquerade as permission changes. Filters, ordering, pagination, picker restrictions and record IDs belong in `params`. Object keys are deterministically hashed by TanStack Query. Do not omit a parameter that changes the response, pass a storage key, or use a mutable form draft as a cache key.

Site changes replace and dispose the entire client, even when the account has access to both Sites. Returning to a former Site therefore performs fresh authorized reads; cross-navigation reuse applies **within** the active Site. A new login/account creates a separate client even if permissions and Site are identical. Logout clears protected content before the existing sign-out action/redirect. The session watcher reports account changes; workspace revalidation rejects mismatched session partitions.

Django remains the authority on every request and mutation. The workspace lease revalidates on focus, explicit refresh and every 30 seconds while the document is visible. Known revocation/module changes replace authorization keys and cancel/remove old protected queries. A protected 401/403 discards the client and revalidates context once per confirmed authorization fingerprint; repeated resource-specific denial shows an error without a bootstrap loop. Denied queries never return previously cached rows. Cancelled old-Site errors cannot clear a newer Site client; failed workspace authorization hides content. There is no new permission cache on Django and no claim of instantaneous remote revocation notification between these checks. Previously delivered browser data cannot be retroactively withdrawn from memory outside the application; no cache entry is treated as authorization for a write or delivery request.

## Migrated readers

| Surface | Resource keys |
| --- | --- |
| Workspace and Site discovery | `workspace`, `site-switcher` |
| Pages | `pages`, `page-counts` |
| Posts | `posts`, `taxonomy` |
| Menus | `menus`, `menu-detail`, `menu-targets`, `menu-locations` |
| Media library/picker | `media`, `media-detail`, `media-references`, `media-policy` |
| Dashboard summaries | Canonical `page-counts` and first-page `media`; aggregates `dashboard-posts`, `dashboard-menus`, `dashboard-users` |

These readers no longer own independent `useAsync` state. `useSiteQuery` is a thin typed adapter over `useQuery`; its `data`, `loading`, `refreshing`, `error`, `reload` and server-confirmed `setData` methods preserve the screens' accessible states. `loading` means no usable data exists; `refreshing` does not replace rows with skeletons. Fresh editable revision/ETag loads, revision-bound private previews and local form drafts remain separate from list caching so a cached list cannot authorize or silently overwrite a newer revision.

Dashboard Page counts and the unrestricted first Media page share the same raw queries with their section readers; cards derive metrics without creating a second response cache. Menu items already present in a navigation response are rendered directly rather than copied into a second detail cache. Unloaded selected trees use the ID-scoped detail query. Media processing polling invokes the same cached list query's `refetch`, sharing in-flight work and preserving the existing bounded polling/failure policy. It does not run a second list transport. Processing metadata cannot replace a newer saved detail response.

Workspace and Site-search GETs consume `AbortSignal` in the HTTP transport. Server Action reads cannot serialize a signal to the server: the query consumes the signal, cancels its observer/cache lifecycle and checks it before accepting the response. Already executing server work may finish, but its result cannot populate an obsolete filter, Site, authorization or session cache. No mutation is retried or treated as cancelled merely because its editor unmounted.

## Mutation coherence

Successful Page/Post/Menu/Media server actions return an additive, serializable invalidation receipt:

```json
{"ok":true,"data":{},"invalidation":{"site":81,"domain":"pages","workspace":false}}
```

`unwrap` / `reportActionResult` forwards a confirmed receipt to the current query provider. Visual Builder writes report it before checking whether the editor is still mounted. Upload acceptance also emits a Site-local media invalidation, including when later optional metadata editing fails. Failed actions emit no successful invalidation receipt or optimistic row. Access failures are reported once and purge the authorization boundary.

| Mutation family | Invalidated families, only in the affected Site/session |
| --- | --- |
| Pages, visual draft and workflow | Pages, counts, menu targets, Page dashboard totals, related sidebar/ref inventories |
| Posts, taxonomy and workflow | Posts, taxonomy, menu targets, Post dashboard totals, media references |
| Menu CRUD/items/order/publication/locations | Directory, selected trees, locations, menu dashboard totals |
| Media upload/metadata/removal | Library/picker variants, detail, reference inventories, media dashboard total |

Homepage assignment additionally refreshes workspace identity context. Invalidation cancels pre-write reads before refreshing active matching queries; inactive variants become stale for their next use. Same-turn invalidation requests are coalesced. Unrelated Sites and entity families remain intact. There is no speculative optimistic content to roll back: validation/conflict/network errors retain confirmed cached rows and the editors' existing recovery behavior. Existing workflow, ETag, media-reference and publication guards are unchanged.

## Verification and reproduction

Tests use a real fresh QueryClient per mounted tree, rather than mocking cache behavior. They cover concurrent deduplication, fresh and stale navigation returns, filter races, mutation/read races, scoped invalidation, failed writes, user/Site changes, revocation, logout, StrictMode and inactive GC. Existing component tests wait for usable rows and explicitly verify that returning to a cached page does not repeat the request.

Use the existing PERF dataset and production profile. `scripts/perf/cache-check.cjs` accepts the private prepared session via stdin and writes public evidence to `PERF_CACHE_CHECK_OUTPUT`. It exercises all four sections, changes/restores a managed draft title, switches Sites and signs out. The regular production harness then records the same navigation matrix as PERF-002. Tests/builds must stop before timing. Do not tee the private session, save raw auth logs or record a HAR containing cookies/headers.

See [local evidence](../qa/P0-PERF-003/2026-11-15/README.md). Performance budgets and methodology remain **PROPOSED** until product/QA accepts them. Deploy the rebuilt admin with its locked dependencies; no database migration or Django API schema change is required.
