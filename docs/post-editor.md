# Formatted news authoring

Open **Site Administration ? Posts ? Create Post** or **Edit** on an editable draft. Choose the active Site first. POSTS must be enabled globally and for that Site; the user needs the existing Site Post authoring grants. The same editor serves the Main Site and child Sites.

Write the title, slug and article body. The toolbar supports paragraphs, H2–H4, bold, emphasis, ordered and unordered lists, quotations and hyperlinks. Select link text before using Insert link. Use a root-relative Site path, HTTPS/HTTP destination or mailto email destination. Scripts, event handlers, embedded HTML, inline styles and unsafe links are removed. H1 belongs to the article title.

Use **Save Draft**, or Ctrl/Cmd+S inside the article. A failed save retains the body and other fields; correct validation errors or retry when the connection recovers. A stale revision displays a conflict. Copy any work you want to retain before discarding and reopening the latest revision. Cancel and browser unload warn about unsaved changes. Existing submit, review and publish actions remain unchanged; a save does not publish.

## Storage and compatibility

The existing Post UUID, Site owner, workflow and revision history remain authoritative. No article schema migration is needed. The API exposes `editor_document` and stores it as `metadata.post_editor`, with matching sanitized HTML in `content` and an empty `blocks` array. The representation is:

```json
{
  "title": "Campus research update",
  "slug": "campus-research-update",
  "editor_document": {
    "schema_version": 1,
    "html": "<h2>Research news</h2><p>A <strong>university</strong> report.</p>"
  }
}
```

Use existing `POST /api/v1/sites/{site}/posts/`, `GET /api/v1/sites/{site}/posts/{id}/` and `PATCH` of the same detail route. PATCH requires the detail response's strong `ETag` in `If-Match`. A stale save returns HTTP 409; missing preconditions retain the existing API behavior. Field validation returns HTTP 400 with `error.details`, including `title` or `editor_document.html` / `editor_document.schema_version` paths. Disabled POSTS writes retain the existing HTTP 400 module error; unauthorized callers get 401/403 and foreign IDs in an authorized Site get 404.

Version 1 requires exactly `schema_version` and `html`. The server permits `p`, `br`, `h2`–`h4`, `strong`/`b`, `em`/`i`, `ul`, `ol`, `li`, `blockquote` and safe `a` elements. Only hyperlink `href` and `title` are retained, with safe `rel`. Limits: 200,000 UTF-8 bytes, 2,000 elements, depth 16, and nonblank visible text. Unknown versions are rejected on writes and fail closed in rendering. The browser canonicalizes b/i to strong/em and native paragraph divs to p. Server sanitization is authoritative; the shared renderer independently rebuilds allowlisted React elements without mounting raw HTML.

Do not send `content` or `blocks` alongside `editor_document`, or write the reserved `metadata.post_editor` key directly. Legacy clients may still send content/blocks; that deliberately clears the editor representation. Metadata-only updates preserve the existing representation. Legacy API reads return `editor_document: null`. Existing text and supported paragraph/heading/list/section content open in the formatted editor. Unsupported structured blocks retain the older block editing mode so media and layout payloads are preserved. Existing public legacy rendering remains available.

Existing revision snapshots include the document. The existing Site-scoped CMS revision restore API/service recovers an older draft as a new revision and retains the historical source. Existing publish snapshots carry the approved document; public Post routes render only those snapshots. Reviewed/published Post locks and role separation are unchanged.

The migration `sites.0011_merge_homepage_module_deactivation` only joins two pre-existing migration branches; it has no schema or data operations. Rehearsal and validation evidence: [Post editor QA](qa/post-editor-2026-11-13/README.md). The authoritative API schema is [OpenAPI](api/openapi.yaml).
