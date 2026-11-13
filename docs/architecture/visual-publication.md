# Revision-bound visual review, preview and publication

Visual Pages use the existing CMS workflow, immutable `ContentRevision` rows,
working drafts and `PublishedContentSnapshot`. A builder has no separate
approval status or publication counter.

## Review and release protocol

1. Submit the saved DRAFT through the normal `workflow/` action.
2. A Site REVIEWER opens the scoped private `preview/` endpoint. Its response
   identifies the exact revision ID, revision number, content hash and ETag.
3. Approve with that exact `If-Match`. The workflow history event links the
   reviewed IN_REVIEW revision and resulting APPROVED revision. Their Page
   presentation payload must match; the status/comment transition is separate.
4. A Site PUBLISHER previews the APPROVED revision and publishes with its ETag.
   The service checks the current revision and approval again under the CMS
   write lock. Missing preconditions return 428; stale revisions return 409.

This conditional contract applies to both Page `workflow/` and the shared CMS
content-workflow API for visual approve/publish/revise actions. Existing legacy
workflow requests remain compatible. Conditional replay can return 409 after a
successful release; it never creates a duplicate snapshot. Reload current state
to reconcile instead of retrying with a newly fetched token automatically.

The approved body remains locked. An AUTHOR can explicitly **Return to draft**
using `action: revise` and the current approved ETag. It creates an APPROVED →
DRAFT workflow event, clears current review attribution and records
`CONTENT_REVISED`. The old approval stays immutable history. Subsequent edits,
including a Slider caption or column-order change, require submit and approval
again before publication. A publisher cannot promote DRAFT content under the
older approval.

Reviewer/Publisher grants come from the existing scoped CMS assignments or
persisted platform-administrator grant. Realm claims do not authorize release;
authors and submitters cannot review their own content. Preview access is
limited to existing Site CMS readers and the enabled PAGES module.

## Private revision preview

`GET /api/v1/sites/{site_pk}/pages/{id}/preview/?revision=8` reads one immutable
revision belonging to this Page and Site. Omit `revision` for the current one.
It returns:

- `revision_id`, `revision_number`, `content_hash`, stored `status`;
- linked `approval_id`, `reviewed_revision_id`, `approved_revision_id` when
  applicable;
- a frozen `page` presentation document for the shared renderer.

The response uses `Cache-Control: private, no-store`, `Surrogate-Control:
no-store`, `Vary: Authorization, Cookie, Host` and `X-Robots-Tag: noindex,
nofollow`. Error responses are also non-cacheable. This route never reads or
writes public publication caches. Anonymous requests fail, and cross-Site Page
or revision IDs cannot be resolved.

Adding `asset_id=<uuid>&variant=thumbnail|display` returns private WebP image
bytes only when that asset is referenced by this exact revision and belongs to
the owning Site. It checks MEDIA, readiness and the normal derivative/original
delivery policy. A CMS Publisher can preview these references without gaining
general Media Library access. Unreferenced or foreign images are not accessible.

Admin previews and visual approval/publication dialogs load this frozen document
through a server action. Images use the revision-scoped same-origin proxy; bearer
tokens stay server-side. The public renderer still uses public snapshot-based
media URLs. Late preview responses are ignored after Page/Site context changes.

Unsaved editor preview is local state and uses authorized private library media.
Local undo, selected slide/tab and other runtime view state are not approval
records. CMS history restore remains an explicit authorized, conditional
operation creating a new DRAFT revision; it never changes the public snapshot
or revives an old approval automatically.

## Atomic publication and asset eligibility

The approved tree, ordered columns/items, schema version, style tokens, title,
template hint, SEO, visibility and locale are frozen in the publication payload.
For a working draft, the published Page's existing canonical route/homepage
identity is preserved under the existing CMS promotion rules.

Before entering the global write lock, publication verifies each distinct image
using the existing delivery checksum, resource-limit and fallback policy for
both responsive variants. Missing derivatives may use a verified private
original; missing or invalid delivery sources block release. Provider failures
are sanitized. These I/O checks do not hold the hierarchy write lock.

After the checks, the service takes the existing CMS lock and rechecks the
source revision, Publisher grant, matching approval, PAGES/MEDIA availability and
nested same-Site ready-image eligibility. It writes the live body, immutable
publication snapshot and PUBLIC media reference inventory in one transaction.
An intervening source revision change fails rather than publishing a different
tree. Normal media lifecycle operations serialize on the same hierarchy guard.

The snapshot stores its approval event and approved revision FKs. Database
guards reject an approval with mismatched reviewed content and reject a visual
publication whose provenance or presentation differs from that approval.
Failures leave the previous live body, snapshot, public references and cache
generation intact. Approved/reviewed/published provenance revisions are protected
from ordinary draft-history pruning.

External storage cannot join the database transaction. Out-of-band object loss
after validation still follows scoped delivery fallback/failure rules; it cannot
expose another Site's object or replace the immutable publication snapshot.

## Cache and migration policy

Publication generation advances inside the database transaction. Shared cache
invalidation runs only with `transaction.on_commit`; rollback keeps both the
previous generation and its cached response. New generations isolate all public
cache keys, and the previous direct-route entry is removed after commit. Cache
deletion failure cannot roll back an already committed publication.

Migration `cms.0015_revision_bound_publication` adds nullable provenance FKs for
backward compatibility and backfills retained workflow history. Existing public
snapshot payloads are never rewritten. New visual publications require revision
bindings. Deferred FK checks are flushed before the migration creates indexes,
so upgrades with real approval history succeed.

See [OpenAPI](../api/openapi.yaml), [draft persistence](visual-draft-persistence.md)
and [revision, permission, asset and cache evidence](../qa/visual-publication-2026-11-12/report.md).
