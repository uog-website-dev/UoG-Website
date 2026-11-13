# Article images

Open a Post from Site Administration and choose a featured image or use Insert image in the article toolbar. Both controls open the existing Site Media Library. Upload files in that picker when your role permits uploading, wait for processing to finish, then select a ready image. PNG, JPEG and WebP are eligible article images. Documents remain available in the library.

Each image use needs alternative text of 1 to 1000 characters. The library text provides an initial suggestion. Featured image text is editable in Post settings. Inline image text is entered before insertion. Removing a featured image clears the article reference and keeps the shared asset in the library.

The MEDIA module and `content.media.view` permission enable selection. `content.media.upload` enables the existing upload panel. Existing Post authoring permissions and the POSTS module govern saves. Direct API calls enforce these checks. Public image delivery requires MEDIA and an eligible current publication under PAGES or POSTS for the resolved Site.

## API and stored identity

The existing Post create and update endpoints accept `featured_media` as `sites/{site_id}/assets/{asset_uuid}` and `featured_alt` as plain text. Send empty strings to remove featured media. New selections require an available, ready, same-Site image. Raw object paths, external URLs, foreign IDs, processing images, rejected images and documents are rejected with field messages. Existing legacy featured paths remain readable and can be replaced or removed.

Version 1 article documents support inline image placements alongside formatted text. Each placement has a distinct UUID and refers to the canonical MediaAsset UUID.

```json
{
  "featured_media": "sites/12/assets/11111111-1111-4111-8111-111111111111",
  "featured_alt": "University library gardens",
  "editor_document": {
    "schema_version": 1,
    "html": "<p>University news</p><img data-asset-id=\"11111111-1111-4111-8111-111111111111\" data-node-id=\"22222222-2222-4222-8222-222222222222\" alt=\"University library gardens\">"
  }
}
```

The server strips supplied image URLs and event handlers. Stored HTML carries asset and placement IDs and alternative text. Featured text resides in the existing revision metadata under `post_media.featured_alt`, and clients write it through `featured_alt`. Public consumers receive approved snapshot values. Renderers construct URLs through the private authenticated proxy or the existing host-resolved public delivery route. Storage keys and credentials stay within the delivery service.

## Revision and removal policy

Saving a Post creates placement records inside the existing revision transaction. Featured and inline uses of the same asset remain distinct. Stale saves cannot replace the latest references. Restoring a revision revalidates its media and records a new revision. Publishing revalidates media eligibility and the MEDIA gate before committing the publication.

Article placements reuse `MediaAssetReference.page_revision`, whose foreign key already targets ContentRevision. The database guard now accepts same-Site Page and Post revisions. The Media Library reports article placements as `REVISION` with `detachable=false`. Their lifecycle follows CMS revision retention. Retained revisions protect assets even after a later draft removes the image. Existing canonical featured references are indexed by the migration without changing their snapshots. Unsupported historical assets remain unavailable through delivery.

Linking and deletion share the existing hierarchy serialization lock. Deletion either completes before linking, causing the save to fail, or linking protects the asset and deletion returns a conflict. Quarantined images return unavailable responses. The public renderer replaces failed inline images with a message containing their alternative text. The editor uses the same fallback for featured previews. Published image delivery rechecks eligibility after storage I/O and uses private, no-store responses.

Migration `media.0013_post_revision_references` extends the existing database function and inventories eligible historical featured references. Its reverse restores the previous function and retains the reference inventory. No content columns or storage objects are copied. Legacy text and structured Post bodies keep their existing renderers.

[OpenAPI](api/openapi.yaml) and [QA evidence](qa/post-media-2026-11-13/README.md)
