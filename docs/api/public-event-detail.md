# Public Event detail API

Anonymous visitors open a published Event through Host-resolved `/api/v1/site-context/` routes. The Site `EVENTS` module must be enabled; otherwise these endpoints return 404 without leaking Event metadata.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/events/{slug}/` | Public detail: banner, category, title, description, schedule window, timezone, venue, contact name, registration flags, and `sections` availability. |
| GET | `/events/{slug}/agenda/` | Multi-day agenda grouped by date then track. Public sessions only. |
| GET | `/events/{slug}/speakers/` | Deduped public people with session roles. Private emails/phones are omitted. |

## Public-safe payload

- `organizer_email` and `organizer_phone` are never returned.
- `contact_name` exposes only the public organizer display name.
- `banner_url` uses `/api/v1/site-context/media/{id}/` so Host-scoped public media delivery applies.
- `sections` tells the UI which tabs have content. Unshipped Gallery, Resources and Updates stay `false` so empty tabs are not shown.
- Draft, archived and foreign private Events return **404**.

Cancelled Events remain listed with `status=CANCELLED`, `accepts_registration=false`, and an optional `cancellation_notice`.

## Independent child sections

Agenda and speakers use section-specific cache headers:

- `Cache-Control: public, max-age=0, must-revalidate`
- `Vary: Host`
- `ETag` derived from the child rows (session or person versions)
- `X-Events-Cache-Scope: site-{id}-event-{slug}[-agenda|-speakers]`
- `X-Events-Cache-Section: detail|agenda|speakers`

Publishing or updating sessions/people becomes visible without re-publishing the Event root.
