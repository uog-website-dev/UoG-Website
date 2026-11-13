# Article settings and taxonomy

Open Site Administration > Posts and choose Create Post or Edit. Post settings provides the title, permalink slug, excerpt, categories and tags. Save Draft stores the article metadata and body together. Reopening loads the current revision marker and selected taxonomy.

The title supports up to 255 characters. Permalink slugs support up to 128 characters using lowercase letters, numbers and single hyphens. The public path is `/posts/{slug}` within the active Site hostname and language. Slugs are unique within that Site and language across drafts and published Posts. Separate Sites can use the same slug. Reserved values are `new`, `edit`, `create`, `admin`, `api`, `preview`, `feed`, `search`, `rss`, `atom` and `index`.

A duplicate permalink produces a field error. Editing the value clears the rejected value's error and enables another save. Excerpts use the existing optional text field and existing request/revision size limits. Categories and tags are optional.

The taxonomy menus load every active page of choices for the current Site. Unavailable selections show their IDs and can be removed from the menu. Reload categories and tags refreshes the choices while retaining the draft. Site ownership and active eligibility are rechecked during the transactional write.

The workflow locks reviewed, approved, published and archived Post metadata. Choose Edit working draft on a published article to revise its metadata while visitors receive the current approved publication. The working copy follows the existing review workflow. Publishing that approved copy creates the original article's next snapshot and preserves its ID and permalink. Unpublish removes the article from public delivery. [Article workflow](post-workflow.md)

## API shapes

Read the detail response and its `ETag` before updating the same route.

```text
GET /api/v1/sites/{site}/posts/{post}/
PATCH /api/v1/sites/{site}/posts/{post}/
If-Match: "cms-content-{post}-r{revision}"
```

Resolve category and tag UUIDs from the active Site taxonomy routes. A metadata update can contain the following fields.

```json
{
  "title": "Campus research update",
  "slug": "campus-research-update",
  "excerpt": "A short university news summary.",
  "categories": ["11111111-1111-4111-8111-111111111111"],
  "tags": ["22222222-2222-4222-8222-222222222222"]
}
```

The response includes the stable Post ID, Site ID, those metadata fields, status, revision number and a new ETag when content changes. Category and tag identifiers refer to eligible rows in that Site. Public responses contain the frozen category/tag labels and published summary.

Invalid title, permalink or taxonomy values return HTTP 400 with field messages in `error.details`. Stale ETags return HTTP 409. An unauthorized writer receives HTTP 401 or 403. Foreign Post IDs under an authorized Site return HTTP 404. Disabled POSTS writes return the existing module error. Rejected requests preserve the Post and its revisions.

Category-only and tag-only updates advance the Post revision and ETag. The relation writes occur inside the existing content revision transaction before the complete snapshot is captured. Revision restore recovers the Post title, slug, excerpt, body and selected taxonomy. Restoring unavailable historical taxonomy returns an actionable validation error.

Post revision history and restore require the POSTS module and existing scoped revision permissions. Restoring an identical payload still records a new revision and its restore origin.

The title, slug, excerpt and taxonomy models use their existing schema. Post slug uniqueness uses the existing `api_validate_taxonomy` trigger and `post_slug_site_uniq` database guard. The implementation extends the existing revision save boundary and restore service.

The schema, fixtures and browser results accompany the implementation. [OpenAPI](api/openapi.yaml) and [metadata QA](qa/post-metadata-2026-11-13/README.md)
