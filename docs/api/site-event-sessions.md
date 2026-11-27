# Site Event session schedule API

Sessions belong to a Site-owned Event and are administered under `/api/v1/sites/{site_pk}/events/{event_id}/sessions/`. Public agenda delivery uses `/api/v1/site-context/events/{slug}/agenda/`. Both require the Site `EVENTS` module. Admin writes require Site-scoped `sites.update`.

## Admin

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/sessions/` | Active sessions with optional `search` / `day` filters plus room and speaker conflict summaries. |
| POST | `/sessions/` | Create a session inside Event date bounds. |
| GET/PATCH/DELETE | `/sessions/{id}/` | Strong session ETag / `If-Match`. DELETE soft-removes; media and document FKs use `SET_NULL` and never cascade-delete assets. |
| POST | `/sessions/{id}/duplicate/` | Clone title, timing, room, track and speakers. |
| POST | `/sessions/reorder/` | Transactional reorder; requires Event `If-Match` and bumps the Event version. |

Session statuses: `SCHEDULED`, `UPDATED`, `CANCELLED`, `COMPLETED`. Visibility: `PUBLIC` or `HIDDEN`. Parallel sessions in different rooms or tracks are allowed. Same-room overlaps are reported as room conflicts; when `block_publish_on_session_room_conflicts` is true on Site Event settings, publish is rejected until they are resolved. Speaker label overlaps are warnings only and do not block publish or reject breaks by default.

## Public agenda

`GET /api/v1/site-context/events/{slug}/agenda/` returns days → tracks → sessions for published or cancelled Events. Hidden sessions are omitted. Cancelled sessions are labelled in admin responses and included publicly unless `hide_cancelled_sessions_publicly` is enabled. Soft-removed sessions never appear.
