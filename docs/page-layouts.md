# Page layouts

Site Administration → Pages → Edit Page provides **Page layout**. Choose Full Width, Left Sidebar or Right Sidebar, preview the draft, then save. The existing submit, review and publication actions release the approved choice. Saving a later draft leaves the published layout unchanged.

| Layout ID | Desktop | Below 900px |
| --- | --- | --- |
| `FULL_WIDTH` | Content only; no sidebar track | Content only |
| `LEFT_SIDEBAR` | Navigation left, content right | Content, then navigation |
| `RIGHT_SIDEBAR` | Content left, navigation right | Content, then navigation |

The content remains first in DOM/keyboard reading order. Sidebar navigation links to the Site home and up to 20 published Pages in the current locale, using the existing hostname-resolved Page listing. It excludes the current Page and rejects foreign-Site responses and unsafe paths. A navigation load failure preserves the Page body and home link. Private previews show the navigation region without querying the administration hostname for public links.

The shell wraps the existing renderer. Builder rows, stable IDs, media references, ordered items, legacy blocks and builder content-width settings are preserved. Full Width removes sidebar space; existing builder width settings still apply inside the content area. Sidebar content is shared Site navigation rather than an additional editable builder document.

## API and compatibility

The existing Page create/PATCH field is `layout`; there is no new route or schema migration. For example, a conditional PATCH to `/api/v1/sites/{site}/pages/{page}/` with the current `If-Match` ETag accepts:

```json
{"layout":"LEFT_SIDEBAR"}
```

A layout-only edit sends only that field and preserves the complete body. Unsupported IDs return a field-level `layout` validation error. Existing Page editing permission, Site scope, module gates and concurrency rules apply. The established module-disabled response remains HTTP 400 with `details.reason=module_disabled`.

Existing empty, `STANDARD` and `LANDING` layouts remain accepted as full-width aliases. The editor displays them as Full Width. Unknown historical layout values remain readable through the full-width rendering fallback; choose an approved value before saving such a Page. The local inventory before implementation contained 21 Pages, all with an empty layout. Existing revisions, restore and publication snapshots already include the canonical Page layout field.

The OpenAPI contract is in [openapi.yaml](api/openapi.yaml). Test and browser evidence is in [the layout QA report](qa/page-layouts-2026-11-14/README.md).
