# AAU homepage comparison and shared builder improvements

Reference captured 22 November 2026; implementation review completed 23 November 2026 (Africa/Addis_Ababa).

## Open the result

- Public comparison: http://aau-review.localhost/ (no hosts-file edit needed).
- Institutional development hostname: http://aau-review.uog.local/ (requires local DNS/hosts mapping).
- Site Administration: http://localhost/admin/sites/102/admin/pages
- Editable working draft: http://localhost/admin/sites/102/admin/pages/2180569c-4d19-4c15-b39e-291ac00a65e3/builder
- Published Page ID: 180d0b82-420d-4d86-838d-d6fb33423029.

Use an existing Platform Administrator account or grant an appropriate membership on this comparison Site through Site Users. The disposable QA account was disabled, its membership revoked and its private credential journal removed after verification.

The separate AAU-COMPARISON Site owns every imported asset, Post, Page and menu. Main and other child Sites were not used for reference publication. The importer verifies other Sites' homepage/configuration values remain unchanged. The full page is an ordinary CMS Page with a versioned builder tree; it has no custom public route or hardcoded renderer behavior for this Site.

## Source and retained data

Reference: [Addis Ababa University homepage](https://aau.edu.et/). Original and local viewport screenshots are attached. Public image provenance, original article links and source dates are in [source-manifest.json](source-manifest.json). News bodies use short authored summaries with links to the original articles; complete original stories were not copied.

- 32 Site-owned READY images, processed by the real private MinIO/Celery pipeline.
- 64 approved derivatives; 32 processing records READY.
- Five news articles and five announcements, published only on the comparison Site.
- Twelve campus slides, five featured partners, four footer menu columns.
- One published homepage and one editable working draft; 11 section rows and 80 layout nodes.
- Re-import retained identical asset/Post/Page/derivative counts: [idempotency results](idempotency-results.json).

Three original photographs exceeded the configured pixel limit. Their browser-optimized AAU image variants were downloaded instead. Upload or decode limits were not relaxed. Original source dates are retained in article metadata/content; public listing timestamps remain the real local CMS publication time, preserving its publication-history contract.

## Capability comparison

| AAU homepage area | Local builder/configuration implementation | Result |
| --- | --- | --- |
| Split-image hero slides and curved image edge | Hero Image inside Layout Slider, four source photographs | Operates by keyboard; bounded autoplay with pause, focus/hover/hidden-tab suspension and reduced-motion support |
| Statistics and impact cards | Features with four equal responsive columns and statistics presentation | Added optional shared settings; legacy Features props still validate |
| Quick links | Button Grid with safe source destinations | Corrected solid button presentation |
| Campus life and gallery | Overlay hero carousel plus Image Grid using the same source photographs | Content/actions reproduced; source floating-card placement is represented by a separate gallery row |
| Featured news | Site-scoped published Loop Grid, news category, featured lead and compact cards | Original images/titles; summaries and source links; real CMS article detail routes |
| Campus exploration | Twelve-slide shared carousel | Each campus image/title is selectable; source 3D fan animation is represented by the approved split-image presentation |
| Featured partners | Anything Carousel with five selectable image thumbnails | Added thumbnail navigation; canonical media references reused |
| Announcements | Published Loop Grid list filtered to announcements | Separate category, deterministic CMS ordering |
| Header/footer branding | Shared Site identity and published menu assignments | Header logo box 100 x 75 px, footer 180 x 180 px; aspect ratio preserved |
| Four footer link columns | Existing multi-menu footer assignments | Published through scoped menu services |
| Newsletter | Per-Site hosted destination in Footer settings | Opens AAU's existing page; no fake subscriber storage or success state |
| Chat | Existing configurable support destination | Hidden until a real provider/destination is configured; no external chat script/account was invented |

This is an editable functional comparison. The shared institutional header/theme, approved decorative tokens, gallery arrangement and campus transition differ from AAU's custom artwork/3D styling. No untrusted CSS, JavaScript or SVG was added to builder payloads.

## Shared fixes

The 43-widget registry and row contract remain intact. Optional validated settings were added to existing widgets:

- Layout Slider / Anything Carousel: navigation = standard, overlay or thumbnails; autoplay_seconds = 0, 5, 8 or 10.
- Features: columns = 1 through 4; presentation = plain or statistics.
- Unspecified widget alignment now inherits the row's alignment; an explicit widget setting still overrides it.
- Button Grid uses the shared solid button component instead of legacy underlined links.
- New settings appear in the existing typed inspector. No separate editor or homepage model was introduced.

The development gateway also accepts registered *.localhost domains, enabling loopback Site previews without system hosts-file edits. Django still resolves authorization/ownership from registered active domains. An unknown *.localhost hostname returned 404 and did not inherit Main Site content.

## Verification

| Check | Recorded result |
| --- | --- |
| Backend shared contract, comparison, templates and publication regressions | 153 passed, zero failures/errors/skips; [JUnit](backend-tests.xml) |
| Full shared UI suite | 241 passed |
| Admin typecheck | Passed |
| Admin/public production builds | Passed |
| Existing admin bundle ceilings | All passed; [bundle report](bundle-report.json) |
| Generated contract and frozen migration snapshot check | Passed |
| OpenAPI validation / missing model migrations | Passed / none |
| Actual public Site at 390, 768 and 1440 px | No overflow, broken images or automated WCAG A/AA violations; [results](public-results.json) |
| Hero keyboard operation, campus slide 12, partner thumbnail selection | Passed at all three widths |
| Exact logo boxes | Header 100 x 75; footer 180 x 180 at all checked widths |
| Real Builder edit, Save Draft, reload and new-tab private preview | Passed; [results](builder-results.json); original draft title restored |
| Public snapshot while private draft differed | Unchanged |
| Live own/foreign Site Page and asset reads, anonymous preview and draft route | All seven checks passed; [security results](security-results.json) |
| Local alias and unknown-host behavior | Alias opens without custom resolver; unknown alias 404 |
| Temporary identity cleanup | Completed; [results](cleanup-results.json) |

Browser checks use real published data and media on the comparison Site. They do not intercept source/widget responses. The AAU source capture is separate from local implementation acceptance. Automated scans supplement the documented keyboard checks; no external QA/security sign-off is claimed.

## Reproduce

1. Capture the current reference with `node scripts/qa-aau-capture.cjs` if updating the audit.
2. Download the frozen image set with `python scripts/fetch_aau_comparison.py --manifest docs/qa/aau-comparison-2026-11-22/source-manifest.json --directory .git/task-data/aau-comparison`. Changed source bytes fail the checksum check and require a reviewed new manifest.
3. Copy that directory into the backend container and run `python manage.py import_aau_comparison --directory /tmp/aau-comparison-source --site 102 --actor <authorized-user>`. This command requires DEBUG, the isolated comparison Site and a live administrator grant. It never enables a production bypass.
4. Run `node scripts/qa-aau-comparison-public.cjs`. The builder scenario reads a disposable review profile through stdin; credentials are never command arguments or tracked files.

## Deployment and rollback

Apply CMS migration 0031_carousel_and_feature_presentation and deploy/restart both frontends and Django after updating schema artifacts. Development processes cache imported JSON schemas, so hot reload alone did not update the running validator; a coordinated restart resolved the initial private-save validation failure. Historical schema snapshots/migrations were preserved.

The migration adds allowlisted optional properties and does not rewrite existing layouts. Before rolling back to a frontend/schema that lacks these settings, save and publish compatible layouts without the new properties on affected Pages, retaining immutable history and a reader capable of displaying it. The source files and imported comparison content are separate from ordinary shared-template defaults.
