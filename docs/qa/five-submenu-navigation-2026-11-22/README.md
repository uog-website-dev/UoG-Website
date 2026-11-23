# Shared five-submenu navigation - 22 November 2026

Menus support six total levels: one top-level item plus five submenu levels. The same bound applies to model and service validation, direct database writes, authoring parent choices/subtree moves, private preview, public menu normalization, header, footer, Builder Menu widgets and frozen Page sidebar validation. Maximum menu item counts and all Site/module/permission/destination checks remain in force.

Desktop grouped panels use wider responsive columns, separated headings, consistent link spacing, restrained shadows and disclosure chevrons. Deep descendants expand inline instead of flying off-screen. Enter/Space toggle branches, Right Arrow expands and focuses descendants, Left Arrow/Escape collapses with focus restoration, and the root Escape closes the panel. Hovering another top-level item closes its predecessor. Mobile uses nested disclosure controls and a bounded drawer; root Escape still closes the drawer. Menu administration shows submenu depth and uses progressive indentation with accessible reorder controls.

## Checks

- Model, DB integrity, Menu API and public delivery regression: backend-tests.xml.
- Added API roundtrip creates six levels, checks private preview, rejects seventh-level insertion without changing ETag, publishes and compares anonymous delivery: roundtrip-tests.xml.
- Shared navigation component: 20 tests passed, including deep keyboard desktop/mobile cases.
- Menu authoring component: 8 tests passed, including fifth-submenu parent selection and excessive parent exclusion.
- Public Page regression: 11 tests passed.
- Main/Informatics Edge browser: six host/viewport cases at 390, 768, 1440 px. Five submenu levels reachable, keyboard operation/focus restoration and one-open-panel behavior verified, no horizontal overflow and zero automated WCAG A/AA violations. Screenshots and browser-results.json attached.
- Admin typecheck and optimized admin build passed. Public build recorded after the final sidebar bound update.
- OpenAPI validation passed; migration 0030 applied locally. Historical menu_sql.py and migrations were not rewritten.

Browser checks inject an anonymous menu-response fixture only; they do not create or publish real Site menu items or change Page content. Persistence/publication is verified by the separate API tests. Reproduce with node scripts/qa-five-submenus.cjs.

Deployment: apply CMS 0030_five_submenu_levels and deploy updated backend/admin/public services. Before rollback, reduce all menus to four total levels; the reverse migration refuses deeper data rather than truncating navigation. Real editor content was not modified by this work.
