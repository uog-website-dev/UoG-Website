# P0-PERF-008 — secure administrative read transport

Admin read-heavy screens use the existing in-memory TanStack Query cache and a
same-origin JSON GET BFF. The trusted browser → Next.js → Django boundary is
retained. A GET handler removes the Server Action/RSC serialization protocol and
its client action queue from these reads; it does not remove the necessary
authentication/authorization hop or permit browser-to-Django bearer access.

## Inventory and scope

The [dated inventory](../qa/P0-PERF-008/2026-11-16/read-inventory.json) lists all
39 exported get/load/list/search/read/preview functions in Site action modules.
Workspace bootstrap and paginated discovery already use GET handlers. Common
Page/Post lists, Page counts, dashboard summary/activity, Media lists/pickers,
Post taxonomy and the Menu directory now use the shared read client. Compatibility
Server Actions remain available for server callers and specialized editor/detail,
preview/binary/history/template operations. Mutations are unchanged Server Actions.

Previously the Post screen awaited categories then tags. They now run together.
The Menu directory previously fetched menus then inheritance; independent reads
now run together. Pagination within one directory remains sequential because
the next page depends on the previous result. Only a bounded 100 pages of 100
records may be collected; exceeding the bound reports an error, not a silently
truncated success. Upstream `next` URLs are never followed: the client constructs
the next same-origin request from a page number.

## Request contract

`GET /admin/api/reads?site=<positive safe integer>&resource=<registered name>`
is private/no-store and varies on Cookie and Accept-Encoding. JSON uses negotiated
streaming gzip when accepted (including respecting gzip;q=0), because route
handlers do not inherit Next's page/Flight compression. The route is force-dynamic. Resource
names are fixed: pages, posts, media, menus, inheritance, categories, tags,
dashboard-summary and dashboard-activity. Each maps to a fixed Django path and
an explicit filter allowlist. There is no supplied URL, hostname, token, arbitrary
path, method or second Site context. Unknown/repeated parameters, invalid Site
IDs and queries over 2048 characters return 400 before an upstream request.
Existing Django pagination/filter validation still applies.

The handler reads the Auth.js encrypted HttpOnly session on the server, obtains
or refreshes its Keycloak access token and attaches the bearer only to Django.
No browser Authorization header is trusted or forwarded. Only JSON data and
allowlisted response metadata are returned; Set-Cookie/Authorization/upstream
credentials are not copied. Auth.js can independently rotate its encrypted
HttpOnly session cookie. Access/refresh token values are never returned through
the session DTO, list response, URL or JavaScript-readable storage.

Django remains authoritative for membership, inactive users/roles, Site scope,
module gates and content visibility. Browser cache keys still contain user/session,
Site, authorization context, resource and filters/page. Identical concurrent
consumers share the query, and mutations invalidate the existing affected Site
resources. There is no cross-user server read cache or permission cache here.
Successful upstream bodies are checked for the requested Site before forwarding.

## Cancellation, deadlines and errors

`useSiteQuery` supplies its AbortSignal to migrated readers. The browser fetch
combines caller cancellation with its 12-second client timeout. Next combines
request cancellation with a 10-second read deadline; Keycloak refresh has an
8-second bound. Cancelling a Site/navigation query aborts transport and retains
the existing logical stale-result guard. A disconnected HTTP client does not
guarantee that PostgreSQL cancels a query already executing in synchronous Django.

Backend validation details and denial status are preserved by the shared
ApiError decoder. Proxy failures use bounded generic messages: unauthenticated
401, invalid query 400, cross-origin read 403, unavailable session 503, invalid/
unreachable upstream 502, timeout 504 and disconnected read 499. Cancellation is
thrown back to TanStack Query rather than cached as a successful/error payload.
No raw provider exceptions, HTML stack traces or credentials are returned.

Every BFF response has X-Request-ID. Existing serverApiFetch instrumentation
correlates the Next and Django spans with navigation IDs. When performance
instrumentation is enabled, Server-Timing exposes BFF total, upstream fetch+
JSON-read time and explicit Response.json encoding time. The total less upstream
approximates session/proxy/JSON-reencoding work;
browser measurements separately record JSON parse time. It is not a CPU-only
serialization benchmark and does not prove that all network time is proxy cost.
Streaming gzip completion happens after response construction and is included in
browser transfer time, not the pre-stream BFF timing span.

## Mutation and CSRF boundary

The read route exports GET only; POST/PATCH/PUT/DELETE do not proxy anything.
Cross-site Fetch Metadata and mismatched Origin are rejected. CORS access is not
enabled. Existing Server Action Origin/Host protections, Auth.js CSRF/session
handling, ETag preconditions and backend mutation authorization remain unchanged.
No GET resource calls a mutation service or exposes an unauthorized API shortcut.

## Verification and deployment

See [dated evidence](../qa/P0-PERF-008/2026-11-16/README.md) for before/after
production navigation, request counts/bytes, correlated upstream timing,
proxy/client authorization and cancellation tests, component regressions and real
Keycloak browser checks. Budgets and methodology remain proposed pending QA.

Rebuild/restart admin-web for deployment. No Django schema migration, API shape
change, CORS widening or browser credential configuration is needed. Other editor
reads can migrate to a separately reviewed fixed resource when measurements
justify it; do not turn the BFF into an unrestricted generic proxy.
