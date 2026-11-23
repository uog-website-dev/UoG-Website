# Homepage starting templates

Site Administration ? Homepage Settings includes the approved catalogue: **University Main**, **College/Department** and **Blank**. Editors and Site Administrators use the same catalogue for Main and child Sites. Eligibility is based on live Site membership and enabled capabilities, not the college name. PAGES and VISUAL_BUILDER must be available before a template can be selected; disabled capabilities produce an explanatory unavailable state.

Preview cards show the template description, manifest version and builder schema compatibility. Desktop/mobile previews use the existing visual renderer. Site-bound widgets display explicit editor placeholders in the catalogue preview so it never reads data for a different host or Site. Previewing does not create, update or publish a Page, change a menu, or assign a homepage. Blank previews a valid empty canvas.

## Choosing a starting point

Open an existing Page's Visual Builder, choose **Homepage templates**, preview a design, then choose **Use ... in this draft**. Confirm the replacement explicitly. This loads an unsaved tree and participates in builder undo; it does not save automatically. Save Draft uses the existing Page API with its ETag, revision history and conflict behavior. Review, publication and homepage assignment remain separate existing operations. Replace sample copy with approved Site content before publication. Published Pages must first open a working draft.

## Publishing and recovery

Homepage Settings identifies the effective published root and the newest pending draft associated with it or created from a homepage starter template. Pending drafts stay private. Editors use the existing Page workflow controls to submit and review them; Publish is offered only when the API grants the current user the publisher action. After publication, assign an eligible published Page through Homepage Settings. Assignment is scoped and locked to the selected Site, and a failed write leaves the previous assignment intact.

In Pages, authorized editors can open **Revisions** and restore an older revision only while the Page is editable. Restore copies the selected snapshot to a new draft revision and records its source; it never changes immutable history or publishes automatically. Submit, review, publish and homepage assignment continue through the normal workflow. A Site without an assigned eligible homepage uses the public empty-root response. Missing Site news or navigation is handled by the existing widget fallbacks.

## Manifest contract

The source registry is `backend/apps/cms/schemas/homepage/`. Each manifest has exactly:

| Field | Contract |
| --- | --- |
| manifest_version | Integer 1; unknown versions unavailable |
| id | Stable catalogue identity, nonempty text up to 80 characters |
| version | Positive integer content version; preparation requires an exact match |
| name / description | Nonempty text up to 120 / 1,000 characters |
| required_modules | Ordered PAGES, VISUAL_BUILDER dependencies |
| layout | Existing Sprint 3 schema-versioned builder document |
| media_slots | Optional bounded Site-image binding slots; version-4 illustrated starters require both slots |

[Manifest JSON Schema](../backend/apps/cms/schemas/homepage/manifest-v1.schema.json) references the canonical builder schema. Backend validation adds the registry policy: templates may use approved editable presentation/media/carousel/form widgets and the Site-bound `site_logo`, `site_title`, `menu` and `loop_grid` widgets inside ordinary sections/columns. Homepage news grids are restricted to published Posts. All normal builder identity, typed props, safe tokens, URL, bounded arrays and size limits apply. Unregistered widgets and unsupported layout versions are rejected. Rich text uses the existing server sanitizer. Manifests contain no Site IDs, image URLs or media asset IDs.

University Main and College/Department **version 4** are shared nine-section starters: split-image hero carousel, educational highlights, quick links, campus carousel, featured published news, a 60/40 research/facilities row with tabs, partnership carousel and a Site enquiry form. Header and footer belong to the shared Site shell and are not copied into Page documents. Sample copy is editable and contains no claimed institutional statistics or partner affiliations.

Illustrated starters require MEDIA in addition to PAGES and VISUAL_BUILDER. Before preparing or applying one, select a ready image from the active Site for **Hero photograph** and **Campus photograph**, and enter meaningful alternative text. The same asset may serve both slots without copying storage objects. Foreign, missing, failed and non-image assets fail normal server validation; attaching requires live media permission. Blank has no image requirement. Catalogue previews use a neutral image illustration and never request another hostname's media.

Template manifests now optionally declare `media_slots`: at most eight unique `{code,label,node_ids}` mappings. Image nodes contain the zero UUID as a registry-only sentinel; every image must be covered by exactly one slot, and concrete storage/asset identities are forbidden in a manifest. Preparation substitutes validated Site-owned asset IDs before minting node IDs. Unbound sentinels cannot be applied or saved as ready media. Existing Pages are not rewritten when the catalogue version changes.

`prepare/` and `apply/` accept an `assets` dictionary keyed by slot code, for example `{"hero":{"asset_id":"<Site-owned UUID>","alt":"Students in the university library"},"campus":{"asset_id":"<Site-owned UUID>","alt":"The main campus courtyard"}}`. Selectors and the existing draft/publication transaction still own reference integrity. Publication additionally checks delivery availability; a database READY flag alone does not bypass missing private objects or derivatives.

Rows and widgets may use the optional safe `style.content_width` token (`full`, `wide`, `reading`). Explicit Page `settings.content_width=full` releases the public shell's outer reading container only for full-width visual Pages. Contained rows retain readable widths; legacy/default Pages and sidebar wrappers keep their existing shell behavior. Preview and public output share the same renderer.

News sources support `presentation=grid|list|featured`. Featured uses one lead article and a compact dated list. Blog, Recent Posts and both Post/Loop carousels use the same scoped published source, never unrestricted queries. Public header search queries only latest eligible publication titles and article excerpts. Search is hostname scoped, bounded to 2?100 characters, page size 10 by default and 20 maximum, and rejects Site overrides and duplicate/unknown query parameters.

All 43 registered widgets now have explicit render handlers. Lottie lazily loads the pinned SVG light player with locally authored, expression-free animation data; new authoring choices are `campus`, `research`, `community` and legacy defaults. Older unknown animation codes retain a safe campus animation fallback rather than invalidating an entire saved document. No arbitrary animation JSON or remote animation path is executed. Reduced motion stops autoplay, and Play/Pause remain available. Videos/maps require an explicit visitor Load action before connecting to their allowlisted provider, and retain outbound-link fallbacks. Countdown is live without per-second screen-reader announcements. Table of Contents uses Page-local headings with stable node-derived anchors; Breadcrumbs reads eligible same-Site published ancestors.

Newsletter signup and support/chat destinations are configured per Site in **Site Administration ? Footer**. Use the institution's approved hosted signup form and support service; both require HTTPS and accessible labels. Controls stay absent until configured. This integration opens the approved service rather than collecting emails without a delivery/consent provider, embedding a tracker or inventing a live chat account.

New templates require a reviewed manifest, deterministic registry ordering, component/dependency review, backend and frontend compatibility checks and evidence before adding their ID to MANIFESTS. Site-bound widgets are limited to the explicit allowlist and rely on the existing runtime's Site isolation. Declaring extra modules alone does not bypass the allowlist. Increment content version when changing an approved document. Unknown or incompatible entries stay unavailable and cannot be prepared.

Preparation deep-clones the validated document and mints fresh node/item IDs. It returns a builder document rather than a new homepage entity. Existing Page storage and revision snapshots remain the sole content model. No migration is required.

## API and security

- GET `/api/v1/sites/{site}/homepage-templates/`: ordered catalogue with availability, reasons and preview layouts. Invalid manifests expose no renderable layout.
- POST `/api/v1/sites/{site}/homepage-templates/prepare/`: strict `{ "template_id": "blank", "version": 1 }` returns template identity/version and `visual_layout`. This operation does not persist content.

Both require Keycloak authentication and a live canonical Site Author/Editor-equivalent grant (or existing Site/Platform Administrator authority). Viewer, Reviewer-only and Publisher-only memberships cannot prepare templates. Foreign Site scope is denied. Requests do not accept client-supplied manifests, Page targets, Site overrides or arbitrary layouts. Unknown fields, stale versions and unavailable capabilities return field-addressed 400 errors; anonymous callers receive 401 and unauthorized callers 403. Responses use private/no-store and noindex headers. Disabled modules may still be explained in the authorized catalogue, but preparation is blocked and the eventual Page-save endpoint independently rechecks permissions/modules.

[Original catalogue verification evidence](qa/homepage-templates-2026-11-15/README.md) predates the dynamic Site widget additions. Refresh desktop/mobile design review and attach updated test results and the PR to Azure DevOps Issue P4-HOME-002 as part of release completion.


### Carousel and feature presentation options

Existing Layout Slider and Anything Carousel widgets accept optional navigation (`standard`, `overlay`, `thumbnails`) and autoplay_seconds (`0`, `5`, `8`, `10`). Rotation pauses for pointer hover, keyboard focus, explicit Pause and hidden documents; reduced motion disables it. Thumbnail selectors use an existing image/hero asset in the slide, without copying storage objects. Controls move below content at narrow widths.

Features accepts optional columns (`1`-`4`) and presentation (`plain`, `statistics`). These are leaf-widget columns, not nested Sections or an expansion of the one-to-three-column row contract. Existing documents keep their defaults. Widget alignment inherits its parent row unless explicitly configured.

The isolated [AAU comparison review](qa/aau-comparison-2026-11-22/README.md) records real imported media, articles, builder/private-preview roundtrip and public viewport results. Shared catalogue templates remain institution-neutral.
