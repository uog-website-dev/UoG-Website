# Homepage starting templates

Site Administration ? Homepage Settings includes the approved catalogue: **University Main**, **College/Department** and **Blank**. Editors and Site Administrators use the same catalogue for Main and child Sites. Eligibility is based on live Site membership and enabled capabilities, not the college name. PAGES and VISUAL_BUILDER must be available before a template can be selected; disabled capabilities produce an explanatory unavailable state.

Preview cards show the template description, manifest version and builder schema compatibility. Desktop/mobile previews use the existing visual renderer. Site-bound widgets display explicit editor placeholders in the catalogue preview so it never reads data for a different host or Site. Previewing does not create, update or publish a Page, change a menu, or assign a homepage. Blank previews a valid empty canvas.

## Choosing a starting point

Open an existing Page's Visual Builder, choose **Homepage templates**, preview a design, then choose **Use ... in this draft**. Confirm the replacement explicitly. This loads an unsaved tree and participates in builder undo; it does not save automatically. Save Draft uses the existing Page API with its ETag, revision history and conflict behavior. Review, publication and homepage assignment remain separate existing operations. Replace sample copy with approved Site content before publication. Published Pages must first open a working draft.

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

[Manifest JSON Schema](../backend/apps/cms/schemas/homepage/manifest-v1.schema.json) references the canonical builder schema. Backend validation adds the registry policy: templates may use the existing editable presentation widgets and the Site-bound `site_logo`, `site_title`, `menu` and `loop_grid` widgets inside ordinary sections/columns. Homepage news grids are restricted to published Posts. All normal builder identity, typed props, safe tokens, URL, bounded arrays and size limits apply. Unregistered widgets and unsupported layout versions are rejected. Rich text uses the existing server sanitizer. Manifests contain no Site IDs, image URLs or media asset IDs.

University Main and College/Department version 3 templates include a responsive identity/header area, configured Site navigation, an editable hero, high-contrast key-link section and a Site news section. The runtime resolves identity, menu and published Posts from the active Site through the existing public widget API. Menu and Posts modules are not added as template prerequisites: when a Site has no published Posts, the news widget shows an explicit empty state; unavailable sources show an explanatory state. Missing or unavailable logo media renders a text placeholder and never reveals an object-storage URL. Editors replace the hero copy and sample destinations with approved Site content before publication. The existing builder controls remain the source of saved content.

New templates require a reviewed manifest, deterministic registry ordering, component/dependency review, backend and frontend compatibility checks and evidence before adding their ID to MANIFESTS. Site-bound widgets are limited to the explicit allowlist and rely on the existing runtime's Site isolation. Declaring extra modules alone does not bypass the allowlist. Increment content version when changing an approved document. Unknown or incompatible entries stay unavailable and cannot be prepared.

Preparation deep-clones the validated document and mints fresh node/item IDs. It returns a builder document rather than a new homepage entity. Existing Page storage and revision snapshots remain the sole content model. No migration is required.

## API and security

- GET `/api/v1/sites/{site}/homepage-templates/`: ordered catalogue with availability, reasons and preview layouts. Invalid manifests expose no renderable layout.
- POST `/api/v1/sites/{site}/homepage-templates/prepare/`: strict `{ "template_id": "blank", "version": 1 }` returns template identity/version and `visual_layout`. This operation does not persist content.

Both require Keycloak authentication and a live canonical Site Author/Editor-equivalent grant (or existing Site/Platform Administrator authority). Viewer, Reviewer-only and Publisher-only memberships cannot prepare templates. Foreign Site scope is denied. Requests do not accept client-supplied manifests, Page targets, Site overrides or arbitrary layouts. Unknown fields, stale versions and unavailable capabilities return field-addressed 400 errors; anonymous callers receive 401 and unauthorized callers 403. Responses use private/no-store and noindex headers. Disabled modules may still be explained in the authorized catalogue, but preparation is blocked and the eventual Page-save endpoint independently rechecks permissions/modules.

[Original catalogue verification evidence](qa/homepage-templates-2026-11-15/README.md) predates the dynamic Site widget additions. Refresh desktop/mobile design review and attach updated test results and the PR to Azure DevOps Issue P4-HOME-002 as part of release completion.
