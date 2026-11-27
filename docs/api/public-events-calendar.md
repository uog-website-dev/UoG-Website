# Public Events directory and calendar API

Anonymous visitors discover Events through Host-resolved `/api/v1/site-context/` routes. The Site `EVENTS` module must be enabled; otherwise these endpoints return 404.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/events/` | Paginated directory. Filters: `search`, `category` (id or slug), `lifecycle`, `on_date` (YYYY-MM-DD). |
| GET | `/events/calendar/?year=&month=` | Month markers. Multi-day Events appear on every covered local date. |
| GET | `/events/categories/` | Active Event categories for the Host Site. |
| GET | `/events/{slug}/` | Public detail with section flags. Prefers the Host Site's own Event when slugs collide under Main aggregation. See [public-event-detail.md](./public-event-detail.md). |
| GET | `/events/{slug}/agenda/` | Multi-day public agenda (date → track → sessions). |
| GET | `/events/{slug}/speakers/` | Public speakers/moderators for the Speakers tab. |
| POST | `/events/{slug}/registrations/` | Optional public registration (capacity/waitlist). See [event-registration.md](./event-registration.md). |

`lifecycle` values:

- `directory_upcoming` — Upcoming tab (not yet ended)
- `directory_past` — Past tab
- `upcoming` / `in_progress` / `past` — exact derived lifecycle buckets

`on_date` selects Events whose `[starts_at, ends_at]` overlaps that calendar day in the Site Event timezone without duplicating cards.

Responses are public-safe: `organizer_email` and `organizer_phone` are omitted. Cache headers use `Vary: Host` and `X-Events-Cache-Scope: site-{id}`.

## Aggregation

College Hosts return only their published/cancelled Events. University Main (`Site.is_main`) also includes **published** Events from other Sites with `public_aggregation_eligible` and an enabled EVENTS module. Cancelled foreign Events and ineligible Sites are excluded. Aggregation never grants cross-Site writes.
