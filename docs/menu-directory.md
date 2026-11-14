# Site menu directory

Site Administration > Menus uses the existing Site-owned Menu and MenuItem aggregates. Administrators can create multiple named menus, search by name or identifier, select a menu, rename it, edit its items, publish it and retire it. This applies equally to the Main Site and child Sites.

Each menu has a stable UUID and an immutable, Site-unique `code` (1–64 lowercase letters/digits separated by hyphens). Creation accepts an optional code; otherwise it is generated from the name for unassigned menus, or from the navigation location for assigned menus. Renaming changes only the name. Duplicate generated identifiers require a different explicit code. Identical codes in different Sites are permitted.

A menu can be unassigned (`location: ""`), or occupy header, footer, sidebar, primary or secondary. Each nonempty local location remains unique within its Site, including retired menus. To replace an assignment, first move the old menu to Unassigned. Global fragments retain platform-only management and require a location. Unassigned menus do not automatically appear in public navigation; they can be reused by eligible sidebar components.

Publish and Retire reuse the existing `is_active` lifecycle and aggregate version. Retirement retains UUID, code, items and location and invalidates affected delivery caches. It does not delete a menu. Existing item target validation, ordering, module checks and audit behavior remain in effect. The directory distinguishes published menus from draft/retired menus. Menu editing uses the selected aggregate's ETag; concurrent changes reject stale writes.

## API

`/api/v1/sites/{site}/menus/` supports scoped list and create. Lists include inactive menus, order by name then UUID, and accept `search`, `is_active`, `page` and `page_size` (default 20, maximum 100). The directory follows pagination and fetches only the selected item tree. Sidebar selection also follows pagination. Requests and returned records remain Site-scoped.

Create example: `{"name":"Student services","code":"student-services","location":""}`. Rename example: `{"name":"Student information"}` with the current `If-Match`. Codes and ownership cannot be reassigned. Existing `/tree/`, `/items/`, `/activate/` and `/deactivate/` contracts remain. `menu.read`, `menu.write`, `menu.publish`, canonical Site membership and MENUS gates are unchanged; editing an active menu also requires publication permission.

Errors use `{error:{code,message,details},request_id}`. Invalid or duplicate codes return field-addressed validation errors; occupied locations return `409` with `duplicate_location`. Stale ETags return `412`, omitted required ETags `428`, and inaccessible foreign records `404`. The UI retains form values and shows server validation messages on failed creation. See [OpenAPI](api/openapi.yaml).

## Migration and rollback

CMS migration `0025_named_menu_directory` adds the code column, backfills legacy local codes from location and global codes as `global-{location}`, and permits unassigned menus. Backfill suppresses only the Menu write/version/audit triggers inside the atomic schema migration so disabled modules do not block upgrade and original IDs, timestamps, aggregate versions, items and assignments remain unchanged. Runtime triggers resume before migration completion. A unique Site/code constraint and database write guard enforce identity even for bulk writes.

Use the migration database role for schema changes. Back up before deployment and apply migrations before restarting updated applications. Rollback to 0024 is guarded: unassigned menus or custom identifiers must be reconciled first. Do not force-drop the code column or delete menus to bypass the guard. Export those definitions and assignments, obtain a deliberate reconciliation decision, and rehearse rollback on a restored database. The rehearsal script records preservation and verifies rejection of an unsafe downgrade; run it only against a development rehearsal database before creating new unassigned menus.

[Validation evidence](qa/menu-directory-2026-11-14/README.md).
