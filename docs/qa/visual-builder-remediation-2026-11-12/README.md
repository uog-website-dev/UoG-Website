# Visual Builder remediation

Verified locally on 12 November 2026 against the working tree. This addendum supersedes the three local blocker findings in the earlier Sprint 3 review. The earlier run and failed live-script attempts remain available as historical evidence.

## Defect dispositions

| Finding | Resolution | Evidence |
| --- | --- | --- |
| Eight required widgets render integration placeholders | Implemented Contact Form, Site Logo, Site Title, Loop Grid, Taxonomy Filter, Post Title, Post Excerpt and Featured Image. Public data uses resolved Site identity and published snapshots. Private builder data requires the scoped Page grant and Builder module. | [Runtime matrix](runtime-matrix.json), [UI tests](ui.xml), [live services](live/live-services.json) |
| Admin TypeScript and production build fail | Typed the media inspector item update and corrected the widget factory test invocation. Workspace TypeScript and both isolated production builds pass. | [TypeScript](typecheck.log), [admin build](admin-build.log), [public build](public-build.log) |
| OpenAPI baseline differs from generated schema | Regenerated the baseline with schema validation and fail-on-warning enabled. Parsed YAML equality passes using the pipeline comparison. | [Schema](../../api/openapi.yaml), [contract verification](contract-verification.json), [backend tests](backend.xml) |

## Review corrections

- Row ratios now respond to the preview container width. A narrow canvas collapses columns even inside a wide browser window.
- Page previews carry the stable Page ID needed for scoped widget queries. Post route changes remount the detail context immediately. Delayed data from the previous scope is ignored.
- Canonical same-Site ready media resolves Site logos and Post featured images through approved delivery routes. A configured Site logo is protected from deletion.
- The Pages test fixture explicitly enables the separately gated Builder module. The live review uses the existing CMS content workflow endpoint for Posts.

## Verification

| Check | Actual result |
| --- | --- |
| Backend widget, public Post, visual draft, publication, media-reference and documentation regressions | 42 passed, [JUnit](backend.xml) |
| Complete shared UI suite | 164 passed, [JUnit](ui.xml) |
| Builder composition, inspector, model, canvas and Pages regressions | 52 passed, [JUnit](admin.xml) |
| Real Keycloak, Django, PostgreSQL, private MinIO, Celery and nginx integration | 100 passed, [results](live/live-services.json) |
| Workspace TypeScript | Passed |
| Admin and public Next.js production builds | Passed |
| OpenAPI generation, validation and baseline comparison | Passed |
| Layout contract generator consistency | Passed |
| Django system check and migration drift check | Passed, no model changes detected |

The live run covers independent Sites, role handoff, upload processing, Slider media, 60/40 layout persistence, approval and publication, homepage assignment, module disable/re-enable, stale saves, foreign IDs, protected deletion, published Post/category providers, identity/logo delivery, private widget preview, and Contact Form receipt replay and validation. Generated review identities are disabled and their local accounts deactivated at completion. Review Sites and audit records are retained.

## Runtime decisions

Contact Form uses Name, Email and Message with maximum lengths of 200, 254 and 5000 characters. Migration `cms.0017_contact_submission` adds Site-owned receipts, a Site/request-ID uniqueness constraint, a Site/date index and an immutable ownership trigger. It was applied to the local development database. Submission requires the form code in the current published Page, validates same-origin browser requests, enforces a 32 KiB request limit and permits five requests per Site/visitor per minute. A replay with identical values returns the original receipt. The implementation stores inquiries. Outbound email delivery and an inquiry-management UI remain outside this change.

Loop Grid reads published Posts or Pages with bounded limits and deterministic ordering. Taxonomy Filter supports active categories or tags attached to published Posts. Post context selection in private preview uses published Posts from the active Site. Site identity uses the existing configured display name and canonical media logo reference. Existing legacy logo strings fall back to the Site name until a canonical asset is configured.

## Remaining release evidence

Interactive browser walkthrough, responsive visual inspection, hosted CI execution and reviewer signatures remain unverified in this addendum. The 43-entry matrix verifies catalog contract and renderer output. Other provider-dependent catalog widgets retain their existing fallback behavior. Full Sprint 3 acceptance still requires the remaining review gates recorded in the earlier review.
