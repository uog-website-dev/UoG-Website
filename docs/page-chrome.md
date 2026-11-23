# Page content versus global Site chrome

The public shell renders one header (brand, header/utility menus, search, call to action) and one footer on every published Page. Page content must not repeat them. This page describes the authoring rules, the legacy compatibility path and the explicit chrome-free mode.

## Palette

The Visual Builder palette no longer offers `site_logo`, `site_title` or `menu`. Search in the widget picker excludes them as well, so there is no authoring route that adds branding or a menu to page content. `page_title` and `breadcrumbs` remain available under **Page & navigation**; breadcrumbs stay a normal content widget.

Homepage templates reject the three chrome widgets in backend validation, so a starting document can never reintroduce them. Homepage news sections keep using published Posts.

## Existing pages

Published layouts that already contain chrome widgets are **not** rewritten. Each node keeps its properties and renders as before, so no Page loses content. When the builder opens such a Page it shows a warning naming the legacy widgets and explaining that they still render; removing them is a normal draft edit that goes through the existing save/review/publication flow. The migration is additive: `cms.0036_page_chrome_setting` and `cms.0037_layout_shape_scalar_alternatives` only rebuild the database layout guard and restore scalar `oneOf` validation, and neither touches a content row or revision.

## Chrome-free Pages

A Page may explicitly hide the global header and footer with `settings.chrome = "none"` (default `"global"`). In the builder this is the **Hide the global header and footer** switch in Page settings; turning it on asks for confirmation, and the warning stays visible while the mode is active. The switch is off for every existing Page.

When enabled:

- The published shell hides its header and footer (they leave layout and the accessibility tree together).
- The Page renders a small `← Site home` navigation bar above the article, so visitors keep an exit route and the Page keeps its own navigation affordance.
- The Page title still supplies the single `h1` under the shared page-heading resolver.
- Nothing else on the Site changes, and the Page remains reachable from the Site header menus until it is published.

Preview in the builder renders the same `PublicPageView`, so the in-page navigation bar and content layout match the published Page. Global chrome itself is not part of the builder canvas.

## Contract and validation

`settings.chrome` is an enum (`global` | `none`); unknown values are rejected by the JSON schema and the database guard. The shared generator `scripts/generate_layout_contract.py` produces the backend schema, frontend fixtures/types and the frozen migration schema; `--check` fails on drift.

`cms_layout_shape_valid` now validates scalar `oneOf` alternatives (approved token or RGB colour) as well as node alternatives. Before this fix, a Page using presentation colours was rejected by the database guard and surfaced as a save conflict even though the Python validator accepted it.

## Evidence

- Backend: homepage template chrome rejection, layout contract cases (chrome `none`, `global` and rejected unknown value), template save/apply suites. Migrations 0036 and 0037 applied, rolled back and reapplied locally.
- Frontend: palette coverage test, legacy chrome detection/renderability tests, chrome-free renderer test with the in-page nav bar and one `h1`, builder picker tests (40 offered widgets, chrome widgets unfindable).
- Not covered here: signed-in browser E2E and before/after visual regression screenshots. They need a Keycloak Site Administrator session and remain reviewer evidence for the Issue.
