# P0-PERF-006: Dashboard essentials

The Site dashboard now uses one essential aggregate request and one independent, optional activity request. It does not call content list serializers to obtain counters. The existing Site/Page/Post/workflow models and module/RBAC contracts remain canonical; there is no new dashboard model or migration.

## Inventory and replacement

| Previous dashboard source | Cost/behavior | Replacement |
| --- | --- | --- |
| Page status helper | Six filtered Page list requests with page_size=1, serialized records and list authorization each time | One conditional COUNT aggregate over Site-owned Pages |
| Posts | Total plus three status list requests, page_size=1 | One conditional COUNT aggregate over Site-owned Posts |
| Menu summary | Full navigation/menu item payload | Two small aggregates over local menus and all their item levels |
| Media | First asset page and technical metadata | Count nondeleted Site assets, without loading records |
| Users | Site directory, assignments and profile serialization | Distinct count of active direct Site members |

`GET /api/workspace/dashboard/?site=<id>` returns schema_version 1, Site ID, generated_at/expires_at, cache metadata and readable section counts. `GET /api/workspace/dashboard/activity/?site=<id>` separately returns at most five recent modified Page/Post identities, titles, statuses and timestamps. No bodies, media storage references, user emails or profile images enter either summary payload. The OpenAPI baseline is updated.

The Page status helper now consumes the same aggregate endpoint rather than six list calls. Dashboard data primes the existing `page-counts` client query with the original generation timestamp; pending older reads are cancelled before priming. The route intent warmer skips a pending essential summary rather than starting a competing count read. Other list queries keep their established contracts and caches.

## Authorization and count semantics

Every API request rechecks active user, live assignments, expiry/revocation, active roles/permissions and effective module dependencies **before** any Redis lookup. Unknown and unauthorized Sites both return 404. Keycloak realm roles do not confer database grants. Query parameters are strict; one positive Site ID is required and foreign scope overrides are rejected.

Pages/Posts require both the registered view capability and the existing canonical CMS read grant. Existing CMS readers (including Viewer membership) may read drafts under the current scoped list policy; this story does not introduce a new published-only/private-draft policy. A custom capability role cannot bypass that CMS grant. Counts include working-draft records and all six existing statuses, matching authoring lists, not public listing eligibility.

Menus count Site-owned nonglobal menus and their draft item rows, including nested/inactive items; inherited/central fragments are excluded, matching the "Local menus" label. Media matches the library's nondeleted ownership scope, including pending/failed processing states. "Active members" counts distinct active users with live, active-role, direct SITE assignments; multiple roles count once and organization/platform grants are not counted as Site directory memberships.

Forbidden/disabled sections are omitted; a database failure marks an eligible section unavailable rather than returning a false zero. Each aggregate has its own transaction/savepoint, so one query failure cannot poison the others. Partial responses are not cached. A summary 404 is a scope-level failure in the client and removes protected cached counts; ordinary record/pagination 404 behavior is unchanged. A live summary that omits an expected read section also purges that Site's other protected queries and requests a fresh workspace context once per mismatch, preventing stale read-grant restoration.

## Cache and freshness

The dedicated Django `dashboard` Redis alias shares the existing Redis service but uses a separate prefix and **200 ms connect/read timeouts**. It does not change public-cache policy. Keys contain Site, requesting user, effective-permission/module/CMS-read fingerprint and a Site generation. Namespace binding is explicit so backend requests and workers invalidate the same Site keys. Authorization itself is never cached.

`DASHBOARD_SUMMARY_TTL` defaults to **15 seconds**, clamped to 1–60 seconds. Successful Page/Post/SiteContent/Menu/MenuItem/MediaAsset/Site membership model writes bump that Site's generation **after commit**; rollback does not invalidate. An old in-flight generation cannot populate the current key. Redis failures fall back to live database aggregates without failing or rolling back successful domain writes. Expiring old generation entries retain their bounded TTL.

Bulk SQL/QuerySet updates, natural assignment expiry and other-user/role activation changes do not all emit those model signals. These use bounded TTL freshness; immediate invalidation is not claimed for them. Client summaries have a 15-second stale time and refresh every 15 seconds while visible. In the worst default timing, a newly mounted client can receive an almost-15-second server snapshot and retain it until its next client refresh: approximately 30 seconds age while continuously mounted, plus network delay. Returning just before the client stale boundary can restart its interval; the conservative default bound is therefore **45 seconds**, or 90 seconds with the maximum configured server TTL. Background tabs refresh on visibility/focus rather than promising these foreground bounds. Updated timestamps, cache origin and refresh-due indicators make this explicit. Domain mutation receipts invalidate the summary client query; user-directory changes rely on the visible refresh interval if no receipt is emitted.

Activity has no shared Redis cache, a 15-second client stale time and a 30-second visible refresh interval. It starts after essential data is available, never uses a blocking skeleton/performance marker, and has independent error/retry UI. Displayed activity kinds are intersected with the latest eligible summary sections so a known module removal cannot retain that module's cached titles.

## Rendering, failure and release evidence

Quick actions remain permission-aware and available while counts load. Usable cached totals stay visible during transient refresh failure with an explicit warning; known scope denial hides them. Empty Sites render intentional zero/empty states. One unavailable aggregate or failed/slow activity widget leaves the other summary cards usable. Text labels/titles render as escaped React text, not HTML.

See [verification evidence](../qa/P0-PERF-006/2026-11-16/README.md) for database/API tests, progressive-widget browser faults, Redis/count reconciliation and production timing. Reproduce the representative production harness with `scripts/perf/run.ps1 -Mode production -Samples 10 -Sites 21`; dashboard API probes are documented in the evidence. The existing dashboard usable <=1.5 s and dashboard API <=500 ms targets remain **proposed**, pending product/QA approval. Deploy rebuilt backend/admin services and restart workers with the updated signal registration. No migration is required.
