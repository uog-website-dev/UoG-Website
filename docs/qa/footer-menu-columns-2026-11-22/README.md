# Footer menu columns - 22 November 2026

## Behavior

Shared Main/child-Site footer supports up to four ordered distinct Site-owned menus. Each menu becomes one equally sized column with its name as heading. One column on phones, two on tablets, all configured columns on wide screens. Existing single-menu and legacy grouped-tree output remain compatible. Empty configured menus retain their heading.

Configure Site Administration > Menus > Template menu locations > Footer > Add footer column. Select menus, reorder with Move left or remove columns, Save Footer draft, then Publish Footer. Publish Footer automatically saves valid changed selections, then publishes the confirmed version. Invalid empty selections and unconfirmed replacements remain blocked. Menus must themselves be published before assignment promotion. Removing all columns and publishing unassigns without deleting menus.

The existing optimistic version, explicit first-menu replacement, Site/role/module checks and private-preview contract apply to the whole ordered set. Server and database guards reject foreign/global/duplicate/oversized references. Assigned menus cannot be deleted or centralized. Publication is atomic; named-menu updates invalidate the owner's explicit assigned slots.

## Verification

- Backend menu-location, public-delivery and preview regressions: 29 passed (backend-tests.xml). Final location suite including the additional named-menu cache refresh regression: 15 passed (location-and-cache-tests.xml).
- Frontend menu location and shared footer components: 9 passed.
- Admin typecheck and both optimized admin/public builds passed.
- OpenAPI validation passed; docs/api/openapi.yaml updated; no missing migrations.
- Migration 0029 applied locally, reversed to 0028 and applied again successfully. Downgrade deliberately refuses multi-column data until reduced to one or none.
- Browser: 6 Main/Informatics viewport checks (390, 768, 1440). Equal column widths verified from actual browser geometry; no horizontal overflow and zero footer axe WCAG A/AA violations. Screenshots and browser-results.json attached.

Browser checks intercept only the anonymous menu response to supply a three-column fixture including an empty menu. They test the actual shared renderer without changing real Site assignments. Persistence, isolation and publication are covered separately by API/database tests. No new menus or assignments were created on the development Sites by this work.

Reproduce browser checks: node scripts/qa-footer-columns.cjs. Backend selection: pytest apps/cms/tests/test_menu_locations.py apps/cms/tests/test_menu_delivery.py apps/cms/tests/test_menu_preview.py -q --create-db.

Follow-up disabled-Publish regression: 8 menu-location component tests passed, including direct publish using the save-confirmed version and retained saved columns with a visible publication failure. Admin typecheck passed.
