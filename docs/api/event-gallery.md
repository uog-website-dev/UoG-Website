# Event gallery API

Site Administrators attach Site Media Library images to Events (optionally Sessions) without duplicating stored files. Delivery reuses Media derivatives, ownership checks, and public/admin image endpoints.

## Association model

| Field | Notes |
| --- | --- |
| `media_asset` | Site-owned READY image (`png` / `jpeg` / `webp`) |
| `session` | Optional same-Event session |
| `caption` / `alt_text` | Caption optional; alt text required to publish |
| `sort_order` | Admin reorder with optional version map |
| `is_published` | Independent of root Event publish |
| `usage_consent` | Required on attach (media usage/consent policy) |

Detaching soft-removes the association only. The canonical MediaAsset remains in the Media Library.

## Admin APIs

| Method | Path |
| --- | --- |
| GET/POST | `/api/v1/sites/{site}/events/{event}/gallery/` |
| POST | `…/gallery/reorder/` |
| PATCH/DELETE | `…/gallery/{id}/` |
| POST | `…/gallery/{id}/publish/` |

Requires Site Administrator + EVENTS. Cross-Site media IDs and PENDING/quarantined assets are rejected.

## Public APIs

| Method | Path | Cache |
| --- | --- | --- |
| GET | `/api/v1/site-context/events/{slug}/gallery/` | `public, max-age=60` |

Returns published, ready images with `thumbnail_url` / `display_url` pointing at `/api/v1/site-context/media/{asset}/?variant=…`. Unpublished, detached, quarantined, or non-READY assets are omitted. Public media delivery also checks `is_event_public_media` so hidden gallery photos cannot be fetched by guessing asset IDs.

## Concurrency

Reorder accepts optional `versions` map of image id → version. Stale versions return conflict so concurrent editors cannot clobber order or visibility.

## Accessibility

Published images require meaningful `alt_text`. The public gallery provides keyboard-focusable thumbnails and a dialog viewer with previous/next/close controls.
