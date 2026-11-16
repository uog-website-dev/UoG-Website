# P0-PERF-004: Site switching

The shared admin shell and memory-only QueryClient now survive Site changes. The authenticated session nonce (or an access-denial reset) remains the outer disposal boundary. `SiteAdminFrame` no longer keys the complete frame; only `SiteEditableContent` is keyed by Site ID, including fullscreen Builder/preview routes. Mutable drafts, selections, dialogs and uploads are never restored from a read cache.

## Routing and transition policy

The searchable Workspace dialog immediately records the selected Site name and starts its scoped bootstrap. The previous Site's body is removed while the Next route is in transit. That name is a discovery hint, not authorization: all content, modules and permissions come from the validated target bootstrap. Failed target bootstrap shows an unavailable state with retry; the switcher remains usable to choose another permitted Site. Back/forward navigation supersedes a failed pending switch.

Switches preserve the current section root (Pages, Posts, Menus, Media, Users, Sidebars, Builder or Homepage Settings) only when the target enables it and grants the relevant section permission. Page/post IDs, preview tokens, query strings and editor-local state are stripped. A Page-specific Builder returns to the target's Builder directory. An unsupported, disabled or forbidden section falls back to that Site's Dashboard. A direct unauthorized deep link retains the existing denied state; it is not silently redirected. No unreadable target Site is replaced by another Site automatically.

Mounted forms with changed controls prompt once before a switch. Page, Post and visual editors also register their precise dirty state, covering rich-text/canvas changes outside forms. Cancel leaves text and context intact; confirmation discards only local unsaved state. Saved revisions remain server-side. The generic form guard is conservative while a changed form stays mounted; navigating away from that form removes its guard. Browser/direct route changes still reset Site-specific content; existing document-unload warnings remain in the editors.

## Cache and authorization policy

This supersedes PERF-003's per-Site QueryClient disposal policy. Keys still contain session, Site, authorization fingerprint, resource and every filter/page parameter. No data is persisted to browser storage. Read entries retain the existing 30-second stale time and five-minute inactive garbage collection; the client is cleared on logout/session change. Mutation receipts invalidate the mutated Site even when the user has since switched elsewhere.

Fresh return visits may reuse their validated context and scoped read data within the original **30-second context lease**. A return does not extend that lease: the refresh timer uses the original validation timestamp. Expired or invalidated context is hidden until a new bootstrap succeeds. During this gate the target's old protected entries are removed. Focus, visibility return and explicit workspace refresh revalidate permissions; concurrent refreshes share the in-flight bootstrap. A changed fingerprint purges only that Site's obsolete protected queries. A failed bootstrap hides all target content and purges its protected entries. Django continues to authorize every read/write; this is bounded UI freshness, not a server-push revocation guarantee.

Site changes abort obsolete HTTP reads and logically cancel Server Action reads. Cache callbacks check the request's Site against the active route. An abandoned success or denial cannot populate or reset the new Site. Read-only caches can remain partitioned for authorized return visits; no component-local form tree is retained.

Page/Post save, workflow, working-draft and revision-refresh completions also check their mounted Site operation before changing UI or navigating. Successful writes still report their original Site's cache invalidation after the editor is gone. An old save cannot redirect the new workspace back to its former Site; the existing Builder already guards these completions.

## Reproduction and acceptance

The existing PERF-001 harness remains the comparable production dashboard-switch measurement. `scripts/perf/site-switch-check.cjs` adds real-service 21-Site keyboard pagination/search, section preservation, zero-read fresh return, stable shell DOM, unsaved draft confirmation, delayed A-B-A denial and actual Django membership revocation/recovery. The revocation test touches only its generated development principal and restores the fixture in `finally`.

```powershell
./scripts/perf/run.ps1 -Mode production -Samples 10 -Sites 21 -Output docs/qa/P0-PERF-004/local
# -Sites 21 prepares the development-only dataset for the discovery regression.
# Pipe prepare-session.py directly to site-switch-check.cjs; never save its output.
```

Use production builds for release comparisons. The current budgets remain **proposed**, pending product/QA approval: warm switch <=1 s and cold switch <=2 s under the PERF-001 conditions. A local smoke run is evidence, not methodology approval. See the [verification record](../qa/P0-PERF-004/2026-11-16/README.md) for exact build, dataset, measurements and limitations. No Django schema/API or migration change is required; deploy a rebuilt admin service.
