# Sidebar content widget evidence — 2026-11-14

Baseline: `da667a22d4647640438d2a97cf4759e2031916e4`. Source hashes are in `source-manifest.json`. These are implementation checks, separate from prototype walkthroughs and independent code review.

## Acceptance results

| Criterion | Actual outcome and evidence |
| --- | --- |
| AC-01 local Menu | Real Keycloak Editor selected the existing Site Menu; private preview and both published sidebar layouts show it |
| AC-02 related Pages | Scoped published Page selector and publication snapshot labels/paths; private/foreign/missing/unpublished targets excluded; selected order retained |
| AC-03 recent Posts | Existing `published_posts` selector, bounded limit, latest eligible snapshots, publication-time/ID ordering; real foreign published Post excluded |
| AC-04 POSTS disabled | Warm public response revalidated; no article labels/links/data in public JSON or UI; Page body and other components remain usable |
| AC-05 forged references | Foreign Menu/Page and duplicate Page IDs rejected atomically; PostgreSQL ownership/schema guards extended |
| AC-06 empty/unavailable | Empty related selection and unpublished source show documented empty state; disabled source shows unavailable state; inactive Menu management preview remains readable |
| AC-07 ordering/responsiveness | Configure and Up/Down retain component IDs; custom order verified at 1440, 768 and 390px; no horizontal overflow |
| AC-08 authorization | Canonical Site CMS authoring grants reused; Reviewer/Publisher API mutation denied; existing anonymous and cross-Site guards retained |

## Automated checks

- [Backend regression](backend-regression.xml): **50 passed**, covering widgets, existing reusable sidebars, Page APIs/layouts, working drafts and revisions.
- [Final backend check](backend-final.xml): **21 passed** after final projection/schema changes, including source filtering, protected downgrade, module gates, cache withdrawal, authorization and legacy Menu compatibility. This overlaps the regression run and is not an additional unique-test total.
- [Frontend workspace](frontend-all.log): **906 passed** — 538 admin, 203 shared UI and 165 API client tests.
- Focused [configuration component](component-tests.xml): **six passed**; [renderer/security](renderer-tests.xml): **six passed**.
- [Workspace TypeScript](typecheck.log): passed. [Admin build](admin-build.log) and [public build](public-build.log): passed using isolated production-build directories.
- OpenAPI generated with `--validate --fail-on-warn`: passed. [Schema](../../api/openapi.yaml) contains exact `oneOf` input shapes with required fields, bounds and forbidden additional properties.
- Django system check: zero issues. Migration drift: no changes. `python scripts/generate_layout_contract.py --check`: passed; the 43-widget contract/artifacts remain unchanged.

Final targeted command: `pytest apps/cms/tests/test_sidebar_widgets.py apps/cms/tests/test_sidebars.py -q --reuse-db`. Use `--create-db` for a fresh suite after transaction/migration tests have flushed seeded lookup data. The regression run was made on a newly created test database. Final XML contains no failures/errors.

## Real services and browser

Real Next.js, Django, PostgreSQL, Keycloak, Nginx and public cache; headless Edge **157.0.4341.46**. No identity bypass or browser request interception. Generated review Sites are `widgetsidebar-4fc0e72065a.uog.local` and `widgetsidebar-4fc0e72065b.uog.local`. Source fixtures include published/private Site A news and published foreign Site B news, related Pages and a stable-ID 60/40 builder body.

- [Authoring](browser-authoring.json): **four passed**. A real Site Editor configured all three components, reordered them, inspected preview, saved the Page assignment and reopened it; original public Page stayed unchanged before publication. Desktop and phone management screenshots are alongside this report.
- [Publication service integration](publication-integration.json): distinct submit/review/publish actors, one shared definition across two published Pages, frozen configuration after later definition rename and protected deletion.
- [Public browser](browser-public.json): **seven passed** — both sidebar positions at three widths and independent-Site isolation. Related/Menu/Post landmarks retain configured order. Actual Tab navigation works. Six scoped WCAG A/AA axe scans: **zero violations and zero incomplete checks**.
- [Negative service setup](negative-services.json) and [browser checks](browser-negative.json): **four passed** — disable POSTS in Site A and unpublish its related source; Page body and Menu remain usable, placeholders replace the unavailable/empty content, and no private/foreign/article data leaks in JSON or UI. Site B's POSTS module stays enabled.
- Screenshots: [configuration](management-desktop.png), [phone configuration](management-mobile.png), [private preview](assignment-private-preview.png), [published desktop](published-left_sidebar-1440.png), [published phone](published-left_sidebar-390.png), [withdrawn sources](disabled-empty-mobile.png).
- [Cleanup](cleanup.json): generated Keycloak/local identity disabled, memberships revoked and private session file removed. An interrupted setup identity was retired before retry. Review data remains as audited evidence; Site A intentionally retains the negative module/source state. A new rehearsal creates a fresh isolated pair.

The initial browser harness needed service readiness handling during development reloads and browser-side DNS for its JSON check. These harness issues were corrected before the recorded passing walkthroughs.

Scripts: `scripts/qa-sidebar-widgets-{seed,browser,publish,public,negative,cleanup}` with the corresponding `.py`/`.cjs` extensions. Copy `sprint3_live_review.py` alongside backend helpers. Supply private configuration/session JSON on stdin; never commit credentials. `UOG_QA_PLAYWRIGHT_ROOT` and `UOG_QA_AXE_PATH` locate local browser tooling. The pytest suite isolates external services; the separate browser/service walkthrough uses the real services above.

## Migration and compatibility

[Rehearsal](migration-rehearsal.json): existing Menu-only definition preserved through downgrade to 0023 and re-upgrade. A persisted widget definition blocks unsafe downgrade. The final integration test additionally proves that a retained Page snapshot blocks downgrade even after its canonical definition is converted back to Menu-only.

`cms.0024_sidebar_content_components` changes the PostgreSQL guard, not tables or stored Page bodies. Existing Sidebar/Page identity, Site/status indexes, ETags, legacy Menu snapshots and Page publication workflow remain in use. Dynamic source configuration stays frozen in the Page revision; only eligible results are resolved at delivery. Configured private Page IDs are removed from public projections. Link projection reads only published identity/title/path fields, not article bodies.

## Review handoff

[User/API/rollout guide](../../sidebar-content-widgets.md). Independent review/approval, PR creation and Azure Issue attachment remain project workflow steps; local evidence does not claim those external approvals are complete. No identified blocking implementation defect remains.
