# Shared homepage and widget completion — 2026-11-22

This implements the [AAU comparison findings](../aau-builder-audit-2026-11-22/README.md) through shared CMS contracts and components. Main and child Sites use the same templates, media binding, editor, runtime, search and footer configuration. There are no production college IDs, hostname-specific branches, copied storage keys or automatic publication changes.

## What is implemented

- University Main and College/Department version 4, each with nine editable sections: split hero carousel, impact/highlight cards, quick links, campus carousel, featured Site news, 60/40 research and tabs, partnership carousel and enquiries. Shared header/footer are not duplicated in the document.
- Two mandatory image slots bind approved ready images from the active Site. Every slot needs alt text. The same asset can be reused; it is not copied or reassigned. Prepare is non-mutating; Apply creates/replaces an existing versioned private Page draft.
- Every one of the 43 widget types has an explicit shared renderer. Previously missing Blog, Recent Posts, Post Carousel, Loop Carousel, Taxonomy, Breadcrumbs, Table of Contents and Lottie now have implementations.
- Grid/list/featured news uses existing publication snapshots, with dates, same-Site validation, taxonomy filters and missing-image behavior. Breadcrumbs resolves published Site-owned ancestry. TOC targets stable node-derived headings.
- Video/maps load only after visitor action and keep external-link fallbacks. Countdown calculates remaining time. Icons render approved glyphs. Lottie uses a lazily loaded pinned SVG player and locally authored animation data, with reduced-motion and Play/Pause controls; no arbitrary animation JSON is evaluated.
- Carousels provide labelled arrow buttons, direct slide selection, current-slide announcement and reduced-motion-safe transitions. Legacy flat Page content keeps its separate renderer.
- Full visual Page width releases the outer public reading container. Safe contained row/widget widths preserve readable content without horizontal overflow. Colors resolve through the current Site theme.
- Hostname-scoped public search reads only latest eligible published Page titles and Post titles/excerpts. No Site override is accepted. Search handles cancellation, failures, empty results and deterministic bounded pagination.
- Per-Site hosted newsletter and support/chat destinations are editable under Footer. These are HTTPS links to institution-approved services, hidden until configured. No provider account, tracking script, secret or subscriber email store is invented by this feature.
- Fixed an existing nested Page publication bug: parent UUIDs are serialized as strings in publication snapshots.

## Browser evidence

[Browser results](browser-results.json) records real Keycloak Site Administrator sessions for Main and Informatics. Through the admin UI, each session selected its corresponding starter, bound ready Site media, created a private draft and opened a new-tab revision preview. Both passed 390/768/1440 px overflow checks, keyboard slide selection and automated axe WCAG A/AA checks. Both existing public homepage API payloads remained unchanged. These checks did not approve or publish actual editorial content.

The Main sample uses the existing synthetic development media image; its flat color is test data, not a missing-image error. Informatics uses an already-existing reference image from its own library. No new AAU media was imported or assigned across Site boundaries.

Real Lottie SVG rendering, reduced-motion autoplay behavior and Play/Pause were additionally exercised in Edge. That utility demonstration was discarded without saving. Temporary identities were disabled and Site grants revoked after verification. Created QA drafts remain private for review:

- Main: `877a8934-0e20-4241-9424-de7a0bef7d73`
- Informatics: `0c8e5301-b5e3-443a-8523-d5135fffec20`

The `public/` screenshots/results cover Main, Informatics and Agriculture public roots at 390/768/1440 px. They verify the existing public fixtures, not publication of the new QA drafts. Automated scans do not substitute for full manual WCAG certification.

## Reproduction

- Contract generation/drift: `python scripts/generate_layout_contract.py --check`.
- Templates: `python scripts/generate_homepage_templates.py` produces the versioned starters, with no Site data.
- Backend: `pytest apps/cms/tests/test_homepage_templates.py apps/cms/tests/test_widget_runtime.py tests/test_site_footer_api.py`.
- Shared UI: `pnpm --filter @uog/ui test`.
- Admin: `pnpm --filter @uog/admin-web exec vitest run --maxWorkers=1` on the bounded local Docker environment.
- Browser: `scripts/qa-shared-homepage-builder.cjs` accepts a disposable private review seed on stdin; credentials must never be printed or committed. `scripts/qa-shared-homepage-animation.cjs` verifies the actual Lottie player. `scripts/qa-public-presentation.cjs` is anonymous and read-only.

API publication tests upload/process actual image bytes through injected storage, apply both templates, run submit/approve/publish with distinct test actors, assign a homepage, read the anonymous result and verify a later draft and the independent Site remain unchanged. The existing publication availability probe is retained; a synthetic READY database row without storage bytes correctly blocks publication.

## Deployment and recovery

Apply cms.0028 and sites.0014 after the existing footer migration sites.0013; rebuild both frontends and deploy the updated backend. The schema changes are additive and do not rewrite Page history. Local cms.0028 reverse/forward rehearsal completed before template application; its final guard snapshot was refreshed during development. Clean test DB migration also exercised the forward chain.

Downgrade requires code/schema coordination. Export footer service settings before removing sites.0014. Before deploying an older renderer/schema that does not understand the new optional layout properties, restore and republish a compatible revision through the CMS workflow and retain backups of newer drafts/snapshots; reversing a guard alone does not rewrite immutable history into an older contract.

Hosted newsletter/chat availability is tested through configuration/link validation. Actual subscription delivery or a support conversation requires the institution's configured external service. No such provider account was created, and no live subscription/chat outcome is claimed. External review, Issue attachments and formal release sign-off remain separate owner actions.


## Recorded results

| Check | Result |
| --- | --- |
| CMS regression run | Passed (524 tests in the exercised CMS/Site-resolution/footer selection before final focused additions) |
| Final focused API, template, search, breadcrumbs and footer suite | 34 passed; [JUnit](api-tests.xml) |
| Upload/process ? template ? review/publish ? homepage ? independent Site and private-draft protection | Both starters passed; [JUnit](publication-tests.xml); also included in the 34-test suite |
| Full shared UI suite | 234 passed; later targeted renderer checks also passed after final refinements |
| Full admin suite, bounded single-worker run | 684 passed, zero skipped/failures/errors; [JUnit](admin-tests.xml) |
| Main and Informatics admin/browser path | Passed; [results](browser-results.json) |
| Public mobile search, published-title match, forged Site override and axe | Passed on both hosts; [results](search-results.json) |
| Existing public fixtures | Nine Site/width combinations passed, zero overflow/axe violations |
| Widget coverage | 43 registered types, 43 explicit handlers; [inventory](renderer-coverage.json) |
| Typechecks and OpenAPI validation | Passed; no missing model migrations |
| Admin/public production builds | Passed; bundle regression check recorded separately below |

One admin test exceeded its existing 20-second deadline during a heavily concurrent exploratory run; its full 25-test builder file and the subsequent complete 684-test single-worker run passed without changing the timeout or weakening assertions. JS DOM cannot animate Lottie, so catalogue parity mocks that component; the actual SVG player was verified in Edge.


Public search additionally clears and cancels results when PAGES/POSTS availability changes for the same Site; the new regression passed. UI package exports now expose narrow shell/theme/toast entry points and mark its pure modules as side-effect-free (there are no import-time CSS files). Server layouts no longer pull the entire content renderer into their client-reference graph. Original bundle ceilings were not changed; [bundle report](bundle-report.json) records the final measurements. Root shell import/session rendering regressions also passed: [JUnit](shell-tests.xml).
