# Asset delivery and removal

Asset UUIDs remain Site-owned and are never reused, including after deletion.
Storage keys and credentials remain server-side. The original object stays in
private MinIO. Image delivery uses approved WebP derivatives or the existing
bounded verified-original re-encoding fallback; there is no public original URL.

## Reference inventory

`MediaUsage` records the current DRAFT or PUBLIC set, with Site, Page, immutable
revision, optional publication snapshot, node ID, field path and repeater item ID.
Image uses `ref`; Slider uses `slides.asset_id`; Gallery uses `images.asset_id`.
A nested section walk reaches every supported placement, through five levels.
Separate placements can name one asset without copying storage or ownership.
Node/item IDs survive reorder; legacy Image blocks without IDs use deterministic
revision-local paths. Historic revisions remain immutable, but superseded
historic snapshots alone do not pin storage forever. Restoring one revalidates
all assets and fails atomically if an asset was deleted.

The revision and publication INSERT triggers replace their respective current
sets in the same DB transaction. A working draft has its own Page ID; removing a
slide from it cannot remove the live Page's PUBLIC set. Publishing the removal
replaces that live set and archives/clears the working draft set atomically.
Unpublishing clears public eligibility. Explicit MANUAL placement indexes remain
protective until individually detached; they do not grant public delivery.

`GET /api/v1/sites/{site}/assets/{uuid}/references/` returns these current sets
and manual placements, without storage references. Automatic entries cannot be
manually detached. Unique `(page,scope,node_id,field_path,repeater_item_id)`
separates slots. Asset FK indexes support removal/inventory checks; the existing
`media_site_status_idx` supports Site/status selection. Audit rows contain actor
and Site; legacy/system backfill uses the source editor or SYSTEM.

## Serialized removal and cleanup

`DELETE /api/v1/sites/{site}/assets/{uuid}/` requires `content.media.delete`,
effective MEDIA and active write scope. No force flag or body fields are accepted.
Any DRAFT, PUBLIC or MANUAL reference returns 409 without changing metadata,
cache generation or storage. Archiving a referenced asset is also rejected.

CMS content/revision/publication writes and media lifecycle/reference services
acquire the existing hierarchy serialization lock before row locks. Statement
triggers enforce the same order for direct content writes, and usage triggers
validate Site ownership and ready state. Deletion and linking serialize: either
linking commits and deletion is blocked, or deletion commits and linking fails.
No dangling reference is committed. The shared lock is intentionally coarse;
partitioning it by Site would require preserving existing IAM/hierarchy ordering.

Accepted removal records immutable `deleted_at`/`deleted_by`, sets ARCHIVED and
creates a one-to-one cleanup outbox in the same transaction. It immediately
vanishes from list/detail/pickers/private images. The 202 response contains asset
ID, cleanup state, attempts and deletion time. Repeated DELETE is idempotent.
`GET .../{uuid}/deletion/` returns QUEUED/RETRY/DONE to authorized deleters.
Tombstones cannot be restored, edited, reassigned or physically removed.

Only after commit is Celery cleanup dispatched. Broker failure leaves the outbox
for reconciliation. Each pass deletes the exact owned original plus both known
and deterministic derivative keys, checks for conflicting active identities,
and retains audit/identity records. Processing and cleanup acquire the same
per-asset PostgreSQL session advisory mutex, using canonical UUID keys. Remote
PUT/DELETE calls hold only that mutex, not the platform hierarchy guard. Short
claim/finalization transactions still acquire the hierarchy guard. Deletion can
commit while a derivative PUT is running, but cleanup defers until that operation
exits and the worker cannot publish derivative metadata for the tombstone. Idempotent S3 delete permits recovery after
a crash or partial pass. A failed pass stays RETRY and hidden; backoff starts at
10 seconds and caps at one hour. The periodic reconciler dispatches due jobs.
Task soft/hard limits are 45/60 seconds. Cleanup retries persist until success;
image decode's separate three-attempt terminal budget is unchanged. Failed
upload-attempt objects remain handled by the existing abandoned-upload reconciler.
An already-authorized cleanup continues if its Site is subsequently archived.

## Delivery and caches

Private image lookup requires Site media-view authorization, current lifecycle
and processing readiness. Anonymous image lookup resolves the Host's Site,
requires effective MEDIA/PAGES, READY state and a PUBLIC inventory entry on a
currently PUBLISHED PUBLIC/UNLISTED Page. MANUAL and draft references never grant
anonymous access. Foreign Site IDs/hosts fail closed. Eligibility is checked
again after storage I/O; lifecycle is rechecked on both private and public paths.

Media bytes and errors use `Cache-Control: private, no-store` and
`Vary: Host, Authorization, Cookie`. Public Page caches already use publication
versions; asset status/tombstone changes also advance every existing locale's
Site publication generation. Old cache entries become unreachable. Rejected
removals leave generations unchanged. Publication removals use the normal
publication invalidation path. No cross-Site derivative cache is used.

Deploy CMS 0013 and media 0009?0011 with backend, worker and frontend changes.
The library exposes a reference count and confirmation for authorized deletion;
the server always rechecks references under the lock even after UI inventory.

Media 0011 repairs reference extraction for historical compact UUID spellings
and rebuilds current inventories without rewriting immutable revision snapshots.
New Image writes canonicalize both Site and UUID identifiers. Portal and editor
readers also normalize compact historical IDs before constructing scoped URLs.
