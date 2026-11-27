# Ordered menu destinations and publication

Site Administration > Menus keeps the existing Menu/MenuItem hierarchy, stable item UUIDs, sibling positions and aggregate ETag. It works for the Main Site and child Sites. Select a menu, then add or edit links and use Move up/down, Nest and Move out with a keyboard, or drag a sibling to reorder it. The hierarchy is limited to four levels and 1000 items. Removing a parent requires removing or moving its children first.

## Destination policy

- **Page**: a stable same-Site Page ID. The picker offers published PUBLIC/UNLISTED Pages with PAGES enabled. A saved existing destination that becomes private/unpublished is marked unavailable and omitted publicly with its descendants.
- **Post**: a stable same-Site Post ID. POSTs must be published, time-eligible and POSTS-enabled for public resolution. Published snapshot slugs are used, keeping later private revisions out of navigation.
- **News listing** (`news`): server-resolved `/posts`; no caller-supplied path or content ID. Requires POSTS.
- **News category** (`category`): stable same-Site Category ID, resolved to `/posts/categories/{slug}` only while active, published and time-eligible with POSTS enabled. The picker excludes foreign and unavailable categories.
- **External URL**: existing HTTP/HTTPS allowlist, with credentials, script schemes, protocol-relative URLs, controls and ambiguous escaping rejected. No server-side URL fetching is performed. This validates destination syntax, not remote availability.
- **Same-site path**: existing bounded local path grammar. These are author-managed paths, not a promise that a public route exists. Prefer typed Page/news/category choices for eligibility tracking.

Foreign Page/Post IDs are rejected at the model, API and database layers. Use an
external URL when a link must point at another Site's public hostname. Category
ownership and target shape are also enforced by a database trigger. No new
workflow for Pages or Posts is introduced.

Saving a same-Site unpublished Page/Post/category reference is permitted as a private draft with `destination_status: unavailable`; publishing is blocked with an item-addressed error until the destination is eligible or the item is disabled/removed. All active destinations are checked at publication, including descendants. Disabled source modules suppress public destinations; unrelated navigation still renders. Missing or removed targets safely disappear, including their descendants.

## Private item edits and publication

Menu items are the working tree. `activate/` validates and copies their complete ordered references into the Menu's server-managed `published_items` snapshot in the same transaction as activation. Public navigation and sidebar Menu projection read that snapshot. Later add/edit/delete/reorder operations update the working tree and aggregate ETag without changing public items. The directory exposes `has_unpublished_changes`, and permitted publishers see **Publish changes** for an active menu. Retire hides the menu while retaining its working and published data.

Editors may edit items in active local menus; publication still requires `menu.publish`. Active menu metadata/location changes retain the existing publish-permission requirement. Central fragments retain platform authority. Existing hierarchy serialization, ownership guards, module checks and immediate database-backed role revocation remain unchanged. There is no new parallel approval workflow or automatic publication.

Existing active menus are backfilled with a snapshot at upgrade, preserving item IDs, sibling positions, timestamps and aggregate versions. Trusted system-created menus without a snapshot retain the legacy projection until first publication; the first API mutation freezes the old working tree before changing it. System jobs must use publication services when they need the same draft guarantees.

Public projection revalidates live eligibility on every menu response, even if a cached projection exists. This prevents stale published links from surviving module disable or target removal after the draft no longer contains their live FK. Cache generations remain Site/location-scoped. Published-content payloads supply Page paths and Post slugs; private content and storage information are not serialized.

## API and concurrency

Existing scoped `/api/v1/sites/{site}/menus/{menu}/items/`, `/reorder/` and item `/move/` endpoints remain. Item writes accept `item_type: page|post|news|category|external|custom`; a category item supplies `category` and no Page/Post/URL. News supplies no destination field. Output adds `category` and `destination_status: ready|unavailable`; server-managed publication snapshots are never accepted or returned by management serializers.

`GET /api/v1/sites/{site}/menus/targets/` returns same-Site eligible `pages`, `posts`, `categories`, `pagesAvailable` and `postsAvailable`. It requires menu-read permission and uses backend module eligibility. The editor consumes this shared contract instead of arbitrary draft content inventories. See [OpenAPI](api/openapi.yaml).

Every mutation requires the current strong Menu `If-Match`. A stale operation returns the existing `409 version_conflict` contract without partial changes; missing ETags return 428. Cycles, excess depth, unsafe destinations and invalid ownership return field-addressed validation errors. Publish failures leave the previous public tree intact. Permission denial returns 403; foreign menu/item reads and writes are scoped and return 404. Audit records include actor/context and owning Site; category retargeting changes the aggregate version and audit whitelist. Successful promotions record `MENU_PUBLISHED` with the new version and item count, without logging external URL query strings or snapshot bodies.

## Migration and rollback

CMS `0026_menu_destinations_and_publication` extends the existing models with a Category FK and private published item snapshot, adds the two item types, updates the database target/audit guards and backfills active menus. It depends on `0025`. No Page or Post content migration is needed. Use the migration database role.

Rollback first flushes pending constraints and refuses new typed news/category items or differences between published and draft item trees. Reconcile these deliberately on a restored rehearsal database before downgrading; do not drop snapshots to expose unreviewed drafts. Back up before deployment. The rehearsal preserves existing IDs, items, positions, versions and assignments across 0025 → 0026 → 0025 → 0026.

[QA evidence](qa/menu-destinations-2026-11-14/README.md).
