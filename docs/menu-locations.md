# Template menu locations

Site Administration > Menus now has a **Template menu locations** panel. Create a named menu and publish its item tree, select it for a slot, save the assignment draft, then publish the slot. Selecting a different menu for an occupied slot requires **Replace current … menu**. Selecting Unassigned and publishing removes the slot's public navigation while retaining the menu and its items.

| Slot | Identifier | Rendering |
| --- | --- | --- |
| Primary Header | `header` | Primary public navigation |
| Utility Header | `secondary` | Separate utility navigation above the primary menu |
| Footer | `footer` | Footer navigation, independent of Header |
| Page Sidebar | `sidebar` | Left/Right Sidebar Page layouts without an explicit reusable Page sidebar |

The registry is declared by `SiteTemplate.menu_locations`, an ordered, unique subset of these four identifiers. The platform template API exposes it under existing `platform.sites.manage_registry` authorization. Invalid, duplicate and unknown entries are rejected by API/model validation and a database trigger. An empty registry intentionally supports no slots. Sites without a template and existing templates default to all four shared-renderer slots. Existing Sites retain their assigned template's renderer capabilities even when its catalogue entry becomes inactive; that status prevents new selection, not existing rendering.

This capability field is separate from the template configuration defaults copied once at Site provisioning. Changing the registry affects slot availability for Sites using that template. Removing support hides the slot publicly and retains its mapping for reconciliation; it does not silently reassign or delete menus. Registry changes therefore require platform review.

## Assignment and publication policy

One `MenuLocationAssignment` row is allowed for each Site/location. It stores separate draft and published Menu FKs, an explicit-publication flag, version, last actor and timestamp. A menu may be reused in different slots. Both FKs must reference a local menu owned by that Site. Central fragments keep their existing platform/inheritance management path.

Drafts may select a draft/retired menu, but publication requires the selected menu to be active/published. Publishing an assignment does not publish the menu's private item edits: it resolves that menu's existing published item snapshot. Retiring the selected menu hides its delivery; the assignment is retained. Changing a referenced local menu into a global fragment is guarded until it is unassigned.

An explicit published assignment is authoritative for its entire slot. A published null assignment is a retained tombstone: it suppresses legacy and inherited fallback. With no published assignment, existing Menu.location and inheritance behavior continues, including while a new assignment draft is being prepared. Existing Menu IDs, items, versions and assignments are not rewritten. The legacy `primary` identifier remains compatible with existing delivery clients but is not a newly assignable template slot. The administration UI uses the new controls instead of the old direct location selectors.

Page Sidebar is a fallback for compatible Page layouts. An explicitly assigned reusable Page sidebar from P4-PAGE-002 takes precedence and keeps its existing publication snapshot rules. Full Width Pages allocate no sidebar space. Narrow layouts keep the existing content-then-sidebar reading order. Explicit empty Sidebar assignments do not restore automatic related-Page links. Preview does not fetch public slot content into a private draft.

Public responses revalidate menu/module/template eligibility. Disabling MENUS removes public delivery and blocks assignment writes; maintenance reads remain permission-scoped. Unsupported or unavailable published slots render no menu. Cache invalidation retains the existing Site/location scope, while public projection is revalidated even when the selected menu's legacy location is empty.

## API

- `GET /api/v1/sites/{site}/menus/locations/`: supported slots, labels, current draft/public Menu IDs, `version`, `is_published` and `has_changes`. Version zero denotes legacy fallback without a mapping row.
- `POST /api/v1/sites/{site}/menus/locations/{location}/draft/`: `{ "version": 0, "menu": "<same-Site UUID>", "replace": true }`. Use `menu: null` for an unassignment draft. Replacement must be explicit when a different draft or published menu occupies the slot.
- `POST /api/v1/sites/{site}/menus/locations/{location}/publish/`: `{ "version": 1 }`. The version must match the saved draft.

Read requires `menu.read`, draft writes `menu.write`, and publication `menu.publish`. Live canonical Site membership and existing module gates apply on every operation. Concurrent writes serialize through the existing hierarchy lock; stale versions return `409 version_conflict` with no partial write. Occupied-slot replacement without confirmation returns `409 replacement_required`. Invalid/foreign menu IDs, unsupported locations, unpublished target promotion and missing fields return field-addressed validation errors. Forging a foreign Site path does not confer permission. The common `{error:{code,message,details},request_id}` envelope remains unchanged.

Successful writes audit `MENU_LOCATION_DRAFT_SAVED` or `MENU_LOCATION_PUBLISHED` with actor, Site, slot and old/new IDs. Public `/api/v1/site-context/menus/` retains its existing shape and adds `configured_locations` so Sidebar rendering distinguishes an explicit empty assignment from absent legacy configuration. No draft assignment IDs are returned publicly. See [OpenAPI](api/openapi.yaml).

## Migration and controlled rollback

Apply `sites.0012_template_menu_locations` and `cms.0027_template_menu_locations` with the migration database role before starting the updated release. They add the capability declaration and mapping table, plus ownership, uniqueness, immutable-identity and serialization guards. Existing Menu/MenuItem rows are unchanged.

The [development rehearsal](qa/menu-locations-2026-11-14/migration-rehearsal.json) verified forward/reverse application with existing menu data intact and rejection of unsafe downgrade. Rollback refuses to drop mappings or non-default template registries. Export those configurations and obtain a reconciliation decision before downgrading a restored rehearsal database. Reusing one menu in several slots cannot always be represented by the older single location field; retain this release or restore a consistent pre-release backup rather than forcing schema removal. Assignment tombstones cannot be deleted through runtime writes because deletion would resurrect legacy navigation.

[QA evidence](qa/menu-locations-2026-11-14/README.md).
