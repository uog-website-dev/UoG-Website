# Visual draft persistence on CMS Pages

The existing Site-scoped CMS Page is the authoring resource. Visual drafts use
its revision number, strong ETag, immutable history, authorization and working
draft workflow. There is no independent builder document or version counter.

## Load and save

`GET /api/v1/sites/{site_pk}/pages/{id}/visual-draft/` returns the Page contract,
including `metadata.visual_layout` when present, original ordered `blocks` for
legacy Pages, `revision_number`, `draft_of` and the strong `ETag` header.
Responses use `Cache-Control: private, no-store`. An active Site CMS role is
required, and PAGES must be enabled. Reading does not create a draft or import
legacy content.

`PATCH` on the same route requires a Site AUTHOR grant, enabled PAGES module
and the exact last-read `If-Match`. The request contains **one complete tree**:

```json
{
  "visual_layout": {
    "schema_version": 1,
    "rows": [{
      "id": "intro", "type": "section", "ratios": [100],
      "columns": [{
        "id": "intro-column", "type": "column", "children": [{
          "id": "intro-heading", "type": "headline",
          "props": {"level": 2, "text": "Welcome"}
        }]
      }]
    }]
  }
}
```

The endpoint replaces the complete visual body, preserving node/item IDs,
array order and other Page metadata. It clears the draft's active legacy
`blocks` in the same transaction; that flat body remains in prior immutable
revisions. When importing a flat Page, first build the complete tree with the
explicit compatibility adapter, review it and submit it here. A normal legacy
Page can continue using the existing Page PATCH API without conversion.

The response is the updated Page plus its current ETag. A meaningful save
advances one revision; submitting an unchanged tree does not invent a builder
version. Clients must retain the returned ETag for their next edit.

Admin server actions `getSiteVisualDraft` and `saveSiteVisualDraft` provide this
typed boundary. Access tokens stay server-side. The existing full CMS form can
still save Page fields and metadata together through normal Page PATCH using
the same revision and reference transaction contract.

## Published Page workflow

For a PUBLISHED Page:

1. Read the published Page and its ETag.
2. `POST .../pages/{published_id}/working-draft/` with that If-Match.
3. Use the returned **draft ID and draft ETag** for visual load/save.
4. Review and publish through the normal CMS workflow when ready.

Working-draft creation now rechecks the supplied published ETag under the CMS
write lock. Visual saves accept DRAFT and UNPUBLISHED Pages. Writing directly
to a PUBLISHED, IN_REVIEW, APPROVED or ARCHIVED Page fails with a status error.
The live Page, publication snapshots, live media references and anonymous output
stay independent while its working draft changes.

## Atomicity and concurrency

The service takes the existing hierarchy transaction lock, rechecks the AUTHOR
grant/module, locks the Page within its Site, and compares its strong ETag
**before** validating or writing the supplied tree. Layout validation and
same-Site, ready-image checks run under that lock. `Page.save()` writes the
complete payload and immutable revision; the revision's database trigger
replaces the nested DRAFT media inventory in that same transaction.

Media references include Image/Hero Image, Image Slider/Image Grid repeated
items and Images inside Layout Slider/Anything Carousel/Simple Masonry content
items. Inventory identity is Page + revision + node ID + field path + repeated
item ID. The existing media locking/ownership/deletion backstops remain active.

Any validation, revision or inventory failure rolls back the Page, revision and
reference changes together. A test injects failure **after** the new revision
and references exist in the transaction and confirms all persisted state returns
to its previous value.

Missing If-Match returns **428**. A stale token returns **409**, using the normal
`error.code: conflict` envelope. Even if two editors changed different Slider
fields, this is whole-document optimistic concurrency: one save wins, the stale
save cannot merge or overwrite it, and its reference changes are not applied.
The typed action does not auto-fetch a new token or retry a stale tree. Keep the
editor's unsaved input, reload the latest draft, reconcile by stable node/item
identity and explicitly save the reconciled complete tree.

## Field-addressed validation

Visual validation returns the normal API error envelope with:

- `error.details.fields`: canonical stored-field paths and messages.
- `error.details.nodes`: path, nearest valid `node_id`, optional `item_id`,
  numeric zero-based `item_index`, and messages.

Example path:
`metadata.visual_layout.rows[0].columns[1].children[0].props.items[1].asset_id`.
It binds to the submitted widget and repeated item, without returning foreign
asset metadata. Invalid/missing IDs produce null bindings; callers fall back to
the complete position path. Standard malformed-JSON errors can occur before the
action receives a body and retain the common API error shape.

See [OpenAPI](../api/openapi.yaml), [layout contract](visual-layout-contract.md)
and [transaction/conflict evidence](../qa/visual-drafts-2026-11-12/report.md).

Approved visual Pages can explicitly return to DRAFT through `revise`; this
requires a fresh review before release. See the [revision-bound publication
contract](visual-publication.md) for immutable previews and snapshot promotion.
