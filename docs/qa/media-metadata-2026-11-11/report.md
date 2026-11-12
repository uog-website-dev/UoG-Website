# Site media discovery and metadata verification ? 2026-11-11

Implemented scoped filename search, lifecycle/type/MIME filters, server-side
ready-image filtering, deterministic UUID tie-breaks, bounded pagination, shared
read/write types and a live media adapter. The Site library now has search/filter
controls, scoped details and alt-text maintenance. Internal object keys and
credentials remain absent from every public asset serializer.

## Contracts and schema snapshots

- [OpenAPI](../../api/openapi.yaml): asset list, scoped detail and metadata PATCH.
- [Extracted OpenAPI filters and read/write schema](openapi-filter-schema.json).
- [Live PostgreSQL constraint/index snapshot](database-schema.json).
- [Discovery, pagination, metadata and thumbnail semantics](../../architecture/media-metadata.md).
- [Typed API adapter](../../../frontend/packages/api-client/src/adapters/media.ts) and [shared metadata/query/write types](../../../frontend/packages/types/src/media.ts).

The original byte-detected MIME remains available as `detected_mime`; the new
`content_type` alias is read-only and always uses that stored value. Persisted
alt text and thumbnail status are typed fields. Thumbnail status is
NOT_GENERATED for images and NOT_APPLICABLE for documents: the checkout has no
thumbnail pipeline, so neither a thumbnail nor an original-file URL is invented.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Site discovery, catalog, ownership/lifecycle and upload integration | 49 passed, 1 skipped | [JUnit](backend-integration.xml) |
| Scoped revision and API/schema regression | 17 passed | [JUnit](api-regressions.xml) |
| Exact page-boundary and mutation fixture rehearsal | 2 passed | [JUnit](fixture-rehearsal.xml) |
| Full Admin regression | 401 passed | [JUnit](admin.xml) |
| Library search, filter, detail, edit and ready-picker checks | 7 passed; included in Admin suite | [JUnit](library.xml) |
| Full API client regression | 163 passed | [JUnit](api-client.xml) |
| Shared portal/UI regression | 89 passed | [JUnit](portal-ui.xml) |
| Workspace typechecks | All five package checks passed | [Summary](verification.json) |
| Django checks / migration drift | No issues / no changes | [Summary](verification.json) |
| OpenAPI validation | Passed with fail-on-warning | [Contract snapshot](openapi-filter-schema.json) |

The one skip is the existing opt-in real-MinIO upload fault test. This story adds
no storage transfer behavior; its prior real-MinIO result remains linked in the
[private upload evidence](../media-uploads-2026-11-11/report.md). No full backend
rerun is claimed here: focused integration plus revision/schema regressions cover
the changed discovery and serialization paths. The full Admin, API client and
portal/UI suites passed after the implementation changes.

## Two-Site fixed-dataset boundary

The [fixture results](two-site-fixture-results.json) are actual authenticated API
responses, not hand-authored examples. Site A contains six READY PNG assets named
Campus.PNG, one PENDING image, one REJECTED image, one ARCHIVED image and one READY
PDF with that same filename, plus a separate literal-percent/underscore filename.
Site B has four READY images also named Campus.PNG. All asset timestamps are
identical to force the UUID tie-breaker.

Searching Site A for `campus` with `ready_images=true`, filename ordering and
page_size=3 returns UUIDs ending 1, 2, 3, followed by 4, 5, 6. Count is six on both
pages, no row repeats, page two has no next link, and repeating page one returns
exactly the same result. The default timestamp ordering produces the same stable
boundary. Foreign, PENDING, REJECTED, ARCHIVED and document assets do not consume
picker page slots even though their filenames match. Site B access is 403 for
the Site A user; a B asset UUID under A is 404.

Additional API cases verify literal `%`/`_` search, case-insensitive matching,
status and MIME/type intersections, full-inventory page boundaries, rejection of
unknown/repeated/invalid parameters, and contradictory ready-image filters.

## Allowed and rejected mutation

The [mutation fixture](mutation-fixture-results.json) saves alt text and records
the actual returned metadata. It then submits an alt-text overwrite together
with Site, byte count and storage identity changes. The response is 400, the
previous allowed alt text remains, Site/size/key stay unchanged and no metadata
audit row is created by the rejected write. A foreign asset edit returns 404.

Additional cases reject ID, original filename, checksum, content type, detected
MIME and thumbnail status changes, and alt text above 1000 characters. Scoped
detail matches the accepted response and contains no bucket, key or credential.
The typed adapter tests confirm the exact scoped URL/query encoding, the
ready-image flag, safe PATCH body and no invented If-Match header. The library
loads fresh scoped details, saves only alt text and hides the save control for a
read-only user; search and clear reset paging to the first page.

## Builder/portal scope

The current Page image picker uses the shared server-side ready-image query;
client filtering remains defense in depth. The shared typed `readyImages` method
is available for Image, Slider and Gallery controls. Existing placement tests
still reject processing/foreign assets and reuse one READY identity across
Slider/Gallery-shaped references.

Advanced Slider/Gallery widgets are absent from this checkout, so no widget UI
browser regression is claimed. Existing portal rendering and Page editor tests
pass; private originals remain private and the portal keeps its image-alt
fallback. No asset bytes, ownership, module activation settings or user role
assignments were modified by this story. No database migration is required.
