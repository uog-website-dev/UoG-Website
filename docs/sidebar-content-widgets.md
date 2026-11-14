# Approved sidebar content widgets

Site Administration → Sidebars now exposes adapters for the existing Menu, Loop Grid (related Page selection) and Recent Posts registry entries. The 43-widget visual document contract is unchanged. These adapters use the reusable sidebar identity, ordering and Page revision/publication contract from P4-PAGE-002.

## Authoring

Select **Component type** and configure:

| Type | Configuration | Required module |
| --- | --- | --- |
| Local Menu (`menu`) | Active local `menu_id` from the current Site | MENUS |
| Related Pages (`related_pages`) | Accessible title and up to 20 distinct ordered `page_ids` from this Site | PAGES |
| Recent Posts (`recent_posts`) | Accessible title and integer `limit` from 1–10 | POSTS |

Use **Configure** to edit a component without changing its stable ID. Up/Down preserves component identity while changing order. Save the sidebar to refresh its saved preview, then select it in a compatible Page draft. Preview, save and publish through the existing Page workflow. Sidebar names, component IDs and source selections remain Site-scoped. No new role or module is introduced.

Related Page selection may include an unpublished same-Site Page for future use; it remains absent from public output until eligible. Related Pages render in selection order. The management picker shows Site-owned Page titles/statuses; foreign IDs and working-draft IDs are rejected on writes.

## Delivery and preview

Menu presentation retains the existing reviewed/frozen behavior. Related Pages and Recent Posts freeze their **configuration**, then resolve results from the existing scoped published-content selectors on each delivery, including after a cache hit. Newly published news can therefore appear without republishing the containing Page. Results use immutable publication snapshots, not private working-draft fields.

- Related Pages require the current Site, the serving Page's locale, PUBLIC visibility, published status and an eligible publication snapshot. Unlisted, hidden, unpublished, missing and future-ineligible targets are excluded.
- Recent Posts reuse `published_posts`: same Site/locale, eligible published main records and serving snapshots; order by publication timestamp then stable descending Post ID, bounded by the configured limit.
- Navigation capacity is bounded to 2000 links, reserving the configured maximum for dynamic sources so later publications cannot exceed renderer limits. Projection reads published title/path fields without fetching article bodies.
- Source module eligibility is checked before reading results. A disabled POSTS module emits no article labels, links or data. The Page body and other components continue to render.
- Public projections omit the configured `page_ids`, so a future/private selection does not disclose draft identities. Internal frozen configuration stays server-side; authorized management reads retain it.
- Menu withdrawal, removed/unpublished targets and disabled modules are revalidated after cache reads. Public Page ETags include the actual projected sidebar content.
- The authorized revision-preview endpoint uses the same scoped delivery projection. Management preview defaults to the Site language; public and revision previews use the serving Page's language.

Empty placeholders are **“No published related Pages yet.”**, **“No published news yet.”** and **“No published navigation links yet.”** Unavailable sources show **“This content is currently unavailable.”** The legacy all-Menu unavailable fallback remains supported. Each component is a labelled navigation landmark with a heading and keyboard-reachable safe links. The shared Page shell preserves component order and stacks content before the sidebar below 900px.

Writes/assignments/publication require each configured source module. Reads remain graceful when a module is subsequently disabled. Re-enabling restores eligible results. A draft configuration change still cannot replace the published Page configuration before review/publication.

## API examples

The existing conditional sidebar endpoint accepts these ordered components:

```json
{
  "name": "Department information",
  "components": [
    {"id":"links","type":"menu","menu_id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"},
    {"id":"related","type":"related_pages","title":"Related information","page_ids":[]},
    {"id":"news","type":"recent_posts","title":"Latest news","limit":5}
  ]
}
```

The exact fields for each type are validated. Unknown fields/types, duplicate IDs/Page selections, foreign references and invalid limits return field-addressed 400 responses without partial writes. Canonical Page authoring grants govern mutation; read-only roles cannot modify components. Existing ETag conflict and deletion guards are retained. OpenAPI: [schema](api/openapi.yaml).

## Migration and rollout

Apply `cms.0024_sidebar_content_components` using the configured migration database role, then deploy/rebuild backend, admin and public applications. The migration replaces the existing JSON integrity function; it adds no tables or data rewrites and preserves legacy Menu-only definitions and Page snapshots.

Downgrade to the Menu-only application is guarded when new component types remain in definitions **or retained Page/publication snapshots**. Removing a widget from the current definition alone is insufficient. Back up and reconcile retained data before downgrade, or use a forward fix; never remove immutable history just to bypass the guard.

[QA evidence](qa/sidebar-widgets-2026-11-14/README.md).
