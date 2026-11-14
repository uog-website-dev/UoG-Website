# Reusable Page sidebars

Site Administration → **Sidebars** manages shared navigation regions. This uses PAGES permissions and the existing Site Menu configuration, rather than introducing another navigation editor or copying builder sections.

1. Create an active local Menu under **Menus**. Its existing target validation, ordering and publication eligibility rules apply.
2. Open **Sidebars**, name the region, add Menu components and order them with Up/Down. Component IDs remain stable when reordered. Save the sidebar.
3. In a Page draft, choose Left Sidebar or Right Sidebar and select **Reusable sidebar**. Preview, save and reopen to verify the assignment.
4. Submit, approve and publish using the existing Page workflow. The same sidebar can be assigned to multiple Pages.

Full Width has no sidebar region. Choosing it clears the assignment in the draft. Choosing **Default Site navigation** in a sidebar layout preserves the original automatically generated navigation behavior for legacy Pages.

## Identity and publication policy

`cms.Sidebar` is the canonical Site-owned definition: UUID, unique name within its Site, ACTIVE/ARCHIVED status, monotonically increasing version, ordered component references, creators and timestamps. It accepts 1–12 components from the initial approved sidebar palette: **Menu**. Each component has a unique stable ID, `type: "menu"` and a same-Site active local `menu_id`. A Menu cannot appear twice. This deliberately reuses the existing navigation component rather than adding unrestricted widget trees, uploads, CSS or arbitrary HTML to a sidebar.

The Page stores one nullable protected sidebar FK. Revision, private preview and publication payloads also carry a frozen `sidebar_snapshot`. This is presentation history, not another sidebar definition. A sidebar rename, reordered definition, Menu rename or Menu item change does not mutate existing Page publication snapshots. Saving a Page with its sidebar selected refreshes the draft snapshot. Publication compares the frozen draft against the current eligible sidebar/Menu projection; a changed dependency requires refreshing, saving and reviewing the draft again. Published output never fetches a live sidebar definition.

Menu projections omit inactive items and ineligible Page/Post targets using the existing Menu delivery selector. Frozen navigation is bounded to 2000 visible items and the existing four-level Menu depth. Public and private renderers independently check Site/ID, safe links, bounded structure and escaped labels. Missing or invalid assigned navigation displays an intentional unavailable state rather than substituting another Site's links.

Sidebar layouts use the shared responsive shell: intended side on desktop, Page content followed by navigation below 900px, with content first in DOM order.

## Access and lifecycle

- Site Administrators and Editors use canonical CMS authoring grants. Other CMS read roles may inspect definitions through the API, but cannot create, change, delete or assign them.
- PAGES must be available for the sidebar API. Creating or editing definitions and assigning/publishing a Menu-based sidebar also requires MENUS. Disabling MENUS or deactivating a referenced Menu suppresses frozen navigation in public Page responses, including cached responses; restoring eligibility restores the same frozen projection. PAGES disablement blocks Page delivery and writes as before.
- Definitions, assignments and referenced Menus must belong to the same Site. Ownership is immutable, with PostgreSQL guards covering bulk/direct writes. No new platform or organization grant is created.
- Conditional update/delete requires the current sidebar ETag. A stale version returns 409; a missing ETag returns 428. The existing Page ETag applies to assignments.
- **Deletion and archive are conservative guards:** any retained Page assignment, including drafts, live Pages and archived working drafts, protects the definition. Historical assignments are not silently discarded to make deletion succeed. An unused definition may be deleted; an unused active definition may be archived. A referenced Menu cannot be deleted until its sidebar references are removed. Published snapshots remain independent of subsequent edits.
- Sidebar create/update/delete audits record actor, Site, version and outcome inside the transaction. Existing Page revision/audit attribution records assignment changes.

## API

`GET/POST /api/v1/sites/{site}/sidebars/`, and `GET/PATCH/DELETE .../{sidebar_id}/`.

```json
{
  "name": "Department navigation",
  "status": "ACTIVE",
  "components": [
    {"id": "department-links", "type": "menu", "menu_id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"}
  ]
}
```

Output includes `id`, `site`, `version`, `components`, a read-only projected `snapshot`, actors and timestamps. List ordering is name then UUID; pagination defaults to 20 and caps at 100. Duplicate names, duplicate component/Menu identifiers, foreign/inactive references and unsupported component types return field-addressed validation errors.

Page assignment uses the existing conditional PATCH:

```json
{"layout":"LEFT_SIDEBAR","sidebar":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"}
```

Use `{"sidebar":null}` to remove the assignment. `sidebar_snapshot`, Site, status and revision fields are not writable by clients. OpenAPI: [schema](api/openapi.yaml).

## Migration and rollback

Migration `cms.0023_reusable_sidebars` adds the definition table and optional Page fields with empty defaults. Existing builder bodies and publication snapshots are not rewritten. It installs database ownership, duplicate-reference, workflow-lock and Menu-deletion guards. Lookup indexes include `(site, status)`, unique `(site, name)` and the Page sidebar FK index.

Apply with the configured migration role, not the restricted runtime database role. Before a production downgrade, back up sidebar definitions, Page assignments and snapshots. The supplied local rehearsal refuses rollback once sidebar data exists; do not blindly downgrade a populated release, because removing the new schema would discard assignments. Prefer a forward fix or a controlled export/reconciliation. Old publication snapshots without sidebar fields remain readable with the legacy default.

Evidence: [reusable-sidebar QA report](qa/reusable-sidebars-2026-11-14/README.md).
