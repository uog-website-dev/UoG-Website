# Site Event records API

Authenticated Event CRUD is mounted under `/api/v1/sites/{site_pk}/events/`. Public discovery uses `/api/v1/site-context/events/`. Both require the Site `EVENTS` module. Admin writes require Site-scoped `sites.update`.

## Admin

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/events/` | Search, status, category, date and lifecycle filters with pagination. |
| POST | `/events/` | Create a draft; incomplete drafts are allowed. |
| GET/PATCH | `/events/{id}/` | Strong ETag / `If-Match` concurrency. |
| GET | `/events/{id}/preview/` | Authenticated preview only. |
| POST | `/events/{id}/publish\|cancel\|archive\|duplicate/` | Publication actions. Cancel closes registration and stores a notice. Publish also asserts the session schedule has no blocking same-room conflicts. |
| * | `/events/{id}/sessions/…` | Multi-day schedule CRUD, duplicate and reorder. See [site-event-sessions.md](./site-event-sessions.md). |

Statuses are explicit: `DRAFT`, `PUBLISHED`, `CANCELLED`, `ARCHIVED`. `lifecycle` (`UPCOMING` / `IN_PROGRESS` / `PAST`) is derived from `starts_at` / `ends_at`.

## Public

Only `PUBLISHED` and `CANCELLED` Events are listed or retrieved by slug. Draft and archived Events return 404 on guessed identifiers. Public agenda is `GET /api/v1/site-context/events/{slug}/agenda/`.
