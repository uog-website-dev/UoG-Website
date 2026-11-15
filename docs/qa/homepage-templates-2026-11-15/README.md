# Homepage starting template verification ? 15 November 2026

Local implementation evidence for P4-F-HOME. This is not external code-review approval or signed release acceptance.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Catalogue API and manifest policy, final source | 13 passed | [JUnit](backend-focused.xml), [output](backend-focused.txt) |
| Layout contract and homepage assignment regression, including the initial 9 catalogue tests | 133 passed | [JUnit](backend-tests.xml) |
| Catalogue and Homepage Settings components | 11 passed | [JUnit](admin-tests.xml), [output](admin-tests.txt) |
| Existing Visual Builder interactions | 25 passed | [JUnit](builder-tests.xml), [output](builder-tests.txt) |
| Admin production build and TypeScript | Passed | [build output](admin-build.txt); explicit typecheck also passed |
| Django system check / migration drift | No issues / no changes | Ran `manage.py check` and `makemigrations --check --dry-run` |
| OpenAPI validation | Passed with fail-on-warn | Generated baseline at `docs/api/openapi.yaml` |
| Real Editor browser workflow | 5 checks passed | [results](browser.json) |
| Mobile axe scan | Zero violations, 24 passing rules | [scan](accessibility.json) |

The 133-test run overlaps the focused catalogue run; these counts should not be added as distinct tests. The focused 13-test run was repeated after malformed-manifest hardening and responsive sample changes. Existing builder tests emit React act warnings; all 25 assertions passed.

## Acceptance evidence

| Criteria | Expected / actual |
| --- | --- |
| AC01 | Authorized Site Editor received University Main, College/Department and Blank; API and browser passed. |
| AC02 | DB hashes before/after browsing, mobile preview and confirmed local selection matched for Pages, revisions, publications and both Site settings. No preview mutation occurred. |
| AC03 | Descriptions, compatibility labels and intended sections rendered with the canonical builder renderer. Blank displayed an intentional empty canvas. Desktop and 390 px mobile screenshots inspected. Large mobile sample padding found during inspection was corrected using existing responsive type tokens. |
| AC04 | Unknown manifest/layout versions are unavailable with reasons and no renderable document; prepare rejected. |
| AC05 | Unknown widget and Site-bound image in a forged registry manifest were rejected; API never accepts arbitrary manifests/layouts. |
| AC06 | Anonymous, Viewer and foreign-Site requests denied. Editor permitted. Privileged preparation is non-persistent; eventual save uses existing authorization/concurrency gates. |
| AC07 | Blank prepares `{schema_version: 1, rows: []}` and validates unchanged. |
| AC08 | Two-Site API catalogue equality with matching capabilities passed; disabled Builder produced unavailable entries and blocked preparation. The implementation contains no college-specific branch. Real browser evidence covers a generated pilot Site; it does not claim a separate newly configured Main Site browser run. |

The API integration also saved a prepared layout via the existing visual-draft endpoint, retained its prior revision, rejected a stale ETag and created no publication. In the real browser an Editor selected College/Department, explicitly confirmed replacement, saved and reloaded the three-section draft. DB checks verified public snapshots, settings and the independent Site remained unchanged.

Screenshots: [catalogue cards](catalogue-cards.png), [desktop preview](catalogue-desktop.png), [390 px preview](catalogue-mobile.png), [saved draft](selected-draft.png). Axe checked WCAG 2 A/AA and 2.1 AA tags. Keyboard Enter selected preview cards. Automated scans and these keyboard checks are scoped evidence, not a complete accessibility certification.

## Environment and reproduction

Real Docker Compose Django/PostgreSQL, Redis, Keycloak and Next.js admin services behind nginx on port 80; headless Microsoft Edge with localhost resolution for generated `*.uog.local`. Run `hometpl-9a9aabe4f6`, Sites 79/80. No production content was changed.

- Backend: `pytest apps/cms/tests/test_homepage_templates.py apps/cms/tests/test_layout_contract.py apps/cms/tests/test_homepage_assignment.py -q --reuse-db --create-db`. Focused final run: `pytest apps/cms/tests/test_homepage_templates.py -q --reuse-db`.
- Frontend: admin Vitest for `homepage-template-catalogue.test.tsx`, `site-homepage.test.tsx`, `visual-builder.test.tsx`; `pnpm --filter @uog/admin-web typecheck`.
- Production build: `node /workspace/scripts/qa/sprint3/build-isolated.mjs admin-web` inside frontend-admin. Public-web source is unchanged by this story.
- Schema: `python manage.py spectacular --file /tmp/homepage-templates-openapi.yaml --validate --fail-on-warn`.
- Browser: `scripts/qa-homepage-template-seed.py`, `qa-homepage-template-check.py`, `qa-homepage-template-browser.cjs`, `qa-homepage-template-cleanup.py`, using the established `sprint3_live_review.py` development identity harness. Session credentials stay in private `/tmp/homepage-template-session.json`; do not attach that file. Set `UOG_QA_PLAYWRIGHT_ROOT` and `UOG_QA_AXE_PATH` to installed Playwright-core/axe paths.

[Cleanup](cleanup.json) confirms generated identity accounts disabled, Site memberships revoked and private session removed. Generated Pages remain as local inspection fixtures. No migration or rollback migration is needed because the canonical Page model is unchanged.

[Source hashes](source-manifest.json) identify this working tree. External approval, CI run, PR creation and Azure Issue attachment remain pending; no Issue identifier was supplied. No blocking defect was observed in this scoped run.
