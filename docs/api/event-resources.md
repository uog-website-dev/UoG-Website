# Event resources & downloads

Site Administrators attach Site-owned Documents to Events (and optionally Sessions) without duplicating stored files. Delivery reuses Media upload, malware scan/quarantine, MIME verification, and private object storage.

## Association model

| Field | Notes |
| --- | --- |
| `document` | Existing Site Document (`file_reference` → READY MediaAsset) |
| `session` | Optional; must belong to the same Event |
| `title` / `description` / `category` | Brochure, Slides, Agenda, Handout, Other |
| `visibility` | `DRAFT`, `PUBLIC`, `REGISTERED_ONLY` |
| `sort_order` | Admin reorder |

Removing an association soft-deletes the `EventResource` row only. The canonical Document/File is retained.

Resources can be published while the Event is In Progress or Completed without republishing the root Event.

## File readiness

Attach and publish require:

- Document belongs to the same Site
- MediaAsset `READY`, processing `READY`, not deleted
- MIME in PDF / DOCX / XLSX / ZIP
- Storage in `platform-private` or `platform-documents` under `sites/{site_id}/`

Pending/quarantined/REJECTED assets cannot be attached or downloaded (safe 404 / validation error; no internal paths).

## Admin APIs

| Method | Path |
| --- | --- |
| GET/POST | `/api/v1/sites/{site}/events/{event}/resources/` |
| POST | `…/resources/reorder/` |
| PATCH/DELETE | `…/resources/{id}/` |
| POST | `…/resources/{id}/visibility/` |
| GET | `…/resources/{id}/file/` (admin preview stream) |

Requires Site Administrator + EVENTS module. Cross-Site document IDs are rejected.

## Public APIs

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/site-context/events/{slug}/resources/` | Metadata cards only |
| POST | `…/resources/{id}/entitlement/` | email + management_token → 5-minute grant |
| GET | `…/resources/{id}/file/` | Stream-after-auth proxy |

Public list includes PUBLIC and REGISTERED_ONLY published resources with ready files. Draft / unpublished / quarantined / removed associations are omitted and return 404 on download.

### Delivery policy

- **No durable object-storage URLs** are issued. Every download is authorized live and streamed with `Cache-Control: private, no-store`.
- **PUBLIC**: GET file (optional `inline=1` for PDF preview).
- **REGISTERED_ONLY**: registration entitlement (confirmed/pending/invited seat holders) via email + `management_token`, or a short-lived HMAC grant (`expires_in=300`). Unpublish/draft invalidates grants immediately at access time even if the grant string has not expired.
- Headers: correct `Content-Type`, `Content-Disposition` (inline PDF vs attachment), `X-Content-Type-Options: nosniff`, noindex.

## Limits & retention

- Upload size and MIME limits follow the shared Media/Documents upload policy (`/assets/upload-policy/`).
- Soft-removed associations are excluded from public and admin lists; Documents remain under Documents retention.
- List responses may be briefly cached (`max-age=30`); file responses are never cached.

## Error states

| Case | Behavior |
| --- | --- |
| Missing / wrong Site | 404 |
| Draft / unpublished | 404 on download |
| Quarantined / not READY | cannot attach; 404 on download |
| Storage failure | 502/503 safe message, no paths |
| Anonymous registered-only | 401 |
| Invalid entitlement | 403 without revealing email existence |
