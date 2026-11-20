# P0-PERF-009 Production bundles and render performance

The admin application defers media and editing tools until they are needed and
keeps Site, query and authorization context values stable across unrelated
updates. On the 20 November 2026 production smoke run, section-navigation p95
fell from 562 ms to 456 ms. The Post editor's estimated initial Brotli JavaScript
fell from 323,510 to 293,289 bytes. These results do not establish a universal
latency improvement: cold Site-switch p95 increased from 406 to 470 ms.

## Deferred modules and editor behavior

The media picker mounts only when opened, with an accessible loading dialog and
Cancel action. Its eligibility/reference helpers live in a separate model module,
so using an image field does not import the entire library. Upload formatting
helpers are also separate from the upload queue. Rich text, media-block controls,
upload controls, homepage templates and Builder inspector fields have separate
async boundaries with reserved loading space.

The library reserves 190 pixels for upload controls while their policy/code loads.
The Upload button remains disabled until its actual file input is mounted. Policy
failures offer retry within that reserved region. Rich-text loading reserves 460
pixels; parent form data remains owned by the editor, so loading/cancelling media
tools does not replace unsaved article text. Site/Page keys and unsaved-change
guards retain their existing behavior.

## Context and subscriptions

SiteAdminFrame, QueryScope, AuthorizationScope and workspace providers memoize
their published values. The mutation invalidation callback remains stable for a
given query client/session, avoiding repeated subscription setup on unrelated
renders. The Site projection is memoized before it reaches the Site frame.
Permission/module/Site/user changes remain dependencies; authorization and
request cancellation rules are unchanged. Editable sections still unmount using
their existing Site boundary; this change does not keep hidden editor trees alive.

Controlled React Profiler probes apply four unrelated parent updates. Each Site,
query and authorization consumer renders once after the change, compared with
five renders before. This is a consumer-render budget, not a claim that every
application commit is eliminated.

## Bundle ceilings and build traces

`frontend/scripts/perf/bundles.mjs` reads a completed production build's
app-build-manifest, unions route and parent-layout JavaScript, and reports raw,
gzip and Brotli estimates plus asset SHA-256 hashes. Async chunks are excluded
from initial totals and checked separately through browser requests. These are
compressed-size estimates, not promises about a browser's negotiated wire format.
The collector requires BUILD_ID, rejects development output, flattens Next trace
arrays and summarizes build spans without recording source, environment values
or trace tags.

Proposed engineering ceilings are in `frontend/scripts/perf/bundle-budgets.json`.
Both CI pipelines check them after a successful frontend build. The Azure frontend
step now stops on failures so a later successful command cannot mask a failed
bundle check. These regression ceilings do not substitute for Product/QA approval.

| Route | Before Brotli bytes | After Brotli bytes | Ceiling bytes |
| --- | ---: | ---: | ---: |
| Shared shell | 268,857 | 269,271 | 275,000 |
| Dashboard | 287,113 | 286,870 | 290,000 |
| Pages | 289,522 | 289,643 | 295,000 |
| Posts | 288,274 | 288,371 | 295,000 |
| Media | 298,444 | 294,747 | 305,000 |
| Page editor | 308,687 | 291,902 | 300,000 |
| Post editor | 323,510 | 293,289 | 315,000 |
| Visual Builder | 339,499 | 319,558 | 335,000 |

The shell and list bundles are effectively unchanged. Most reduction comes from
moving editor/media code behind the appropriate boundaries. The render ceiling
is one consumer render across four unrelated parent updates. Durations from
individual browser visits remain diagnostic, with no inferred percentile or
strict per-component millisecond SLA.

## Production and development attribution

`next build` precompiles release routes. A production first visit still pays
network, session, API, JavaScript parsing/hydration and rendering costs; it does
not compile that route. `next dev` adds on-demand compilation and HMR behavior.
Collect those compilation events with `scripts/perf/collect-dev-compiles.cjs`
rather than attributing their delay to production APIs.

The current development run recorded 14 compilation events, including an 8.9 s
root compilation. The readiness request can compile that root before navigation
timing starts. The single first-Site diagnostic was 8.101 s in development versus
2.901 s in production; neither is a population p95. Production navigation uses
10 samples per scenario; development uses two as an attribution diagnostic.
Do not combine the two populations or treat the small development run as release
acceptance.

## Browser and React profiling

`scripts/perf/render-check.cjs` checks dashboard, Pages, Page/Post editor and
Builder deep links in an authenticated browser. It records CDP script/layout
time, long tasks, layout-shift sums, asset names and cache headers. Its editor
exercise retains unsaved text through picker open/cancel. New pages reset CPU
counters and disable the HTTP script cache. These are individual diagnostics,
not repeated-route percentiles.

Set `PERF_RENDER_PROFILING=1` only for a separate diagnostic build. The opt-in perf
compose profile enables Next's production React profiling runtime and
NEXT_PUBLIC_RENDER_PROFILING. RenderProbe then records bounded numeric timings
for the shell, dashboard, rich-text and Builder subtrees; no props, titles,
content, tokens or user IDs are collected. Ordinary production and development
builds keep the probe disabled. Profiling-build bundles and timings are excluded
from release baselines because the profiling runtime adds overhead.

## Prefetch and privacy

The existing common-section prefetch policy remains: explicit hover/focus intent,
a 180 ms dwell and a one-second throttle, with fresh authorization/module context,
data-saving and visibility checks. Other existing Next link behavior is preserved.
Hashed Next static assets retain public immutable caching; scoped workspace/read
responses and protected routes retain private caching behavior. There is no new
server data cache, public private-data response or browser bearer-token path.

## Reproduction and deployment

Run the existing perf harness on an isolated development dataset with real
PostgreSQL, Redis, Keycloak and MinIO. The managed dataset contains 21 Sites;
each has 40 Pages, 100 Posts, 80 assets and four menus. Use production mode for
the baseline, then development mode separately. Keep builds, seeds, test suites
and other diagnostics outside timed navigation batches. Private seed/session
configuration must pass through stdin and must not be copied into evidence.

After a production build, run `pnpm --filter @uog/admin-web perf:bundles` and
`pnpm --filter @uog/admin-web perf:test`. For an isolated running perf server,
invoke the bundle collector inside perf-admin; use `--root` to select a specific
build when several exist. The ordinary development .next directory need not be
overwritten. The React profiling build requires the separate flag described above.

[Dated evidence and regression results](../qa/P0-PERF-009/2026-11-20/README.md)
include the build traces, bundle hashes, navigation comparisons and browser checks.
Rebuild admin-web to deploy. No Django migration or API contract change is needed.
Product/QA methodology approval and external code review remain pending.

The dated run did not emit React callbacks in the optional production profiling build. Its diagnostic is marked failed; use the recorded CDP measurements and controlled provider tests, and resolve this instrumentation before full production component-profile acceptance.
