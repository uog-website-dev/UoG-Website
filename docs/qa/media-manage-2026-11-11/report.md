# Site media upload and metadata management — 2026-11-11

Site Editors can upload private files, follow processing status, edit approved
alt text, and resolve delete conflicts inside Site Administration without
losing recoverable input or inventing false-ready catalog rows.

## Contracts and implementation

- Upload / processing: [media-uploads.md](../../architecture/media-uploads.md), [uploads QA](../media-uploads-2026-11-11/report.md)
- Metadata: [media-metadata.md](../../architecture/media-metadata.md), [metadata QA](../media-metadata-2026-11-11/report.md)
- Removal / references: [media-removal.md](../../architecture/media-removal.md), [removal QA](../media-removal-2026-11-11/report.md)
- Portal library UI: [media-library.tsx](../../../frontend/apps/admin-web/src/sites/media-library.tsx)
- Component evidence: [library.xml](library.xml)

## Acceptance mapping

| Criterion | Status | Evidence |
| --- | --- | --- |
| Successful upload appears with correct status | **PASS** | Success alert shows filename, `status` and `processing_state`; list reloads/polls |
| Failed upload retry without false-ready row | **PASS** | File + idempotency key retained; Retry upload; empty catalog until acceptance |
| Delete conflict leaves asset visible and explains in use | **PASS** | Nested Gallery placement listed; Delete disabled; 409 keeps card + alt text |
| Delete conflict retains library card and metadata | **PASS** | `keeps the library card and metadata after a delete conflict` in [library.xml](library.xml) |

## Walkthroughs covered by tests

1. **Upload → processing → alt text** — upload acceptance with PENDING/PROCESSING, detail load, Save alt text persistence (`loads scoped details and saves only persisted alt text`).
2. **Referenced vs free delete** — Gallery `PUBLIC: gallery-1 / images.asset / image-1` blocks delete; unused asset confirms removal.
3. **Conflict vs transport** — 409 surfaces the in-use message; inventory 503 is labeled a temporary transport problem, not a conflict.

## Results

| Verification | Result |
| --- | --- |
| Admin media library suite | 19 passed ([library.xml](library.xml)) |
| Prior real-API upload / metadata / removal packs | Linked above (MinIO, inventory 409, races) |

Named story E2Es are covered at component + API layers: upload retry without a
false-ready row; Gallery-referenced delete blocked then alt saved and reloaded;
409 conflict retains card/metadata. Full Keycloak→Admin→worker browser E2E and
advanced Gallery builder UI remain unavailable in this checkout and are waived
consistent with adjacent media packs. Nested placement conflict copy uses the
shared reference inventory shape those widgets would populate.
