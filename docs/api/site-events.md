# Site Event Management API

Event Management settings are mounted under `/api/v1/sites/{id}/event-settings/` and Event categories under `/api/v1/sites/{site_pk}/event-categories/`. Both require Keycloak bearer authentication, Site-scoped `sites.update`, and an enabled `EVENTS` module for that Site. Disabling the module blocks reads and writes without deleting retained `SiteEventSettings` or category rows.

## Settings

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/sites/{id}/event-settings/` | Returns defaults when no row exists. Strong ETag. |
| PATCH | `/api/v1/sites/{id}/event-settings/` | Requires `If-Match`. Validates timezone, public list path, registration defaults, aggregation eligibility, room-conflict publish blocking and cancelled-session public visibility. |

`aggregation_write_access` is always `false`. Setting `public_aggregation_eligible` only marks the Site for future University Main public listing; it never authorizes modification of another Site's Event records.

Schedule settings:

- `block_publish_on_session_room_conflicts` (default `true`) rejects Event publish while same-room overlaps exist.
- `hide_cancelled_sessions_publicly` (default `false`) omits cancelled sessions from the public agenda instead of labelling them.

## Categories

Categories reuse `api.Category` with `kind=EVENTS`. Create, update and soft-deactivate (DELETE) are Site-scoped. Codes default to `EVT_*` when omitted.

## Public context

When `EVENTS` is available for the resolved Site, `/api/v1/site-context/` includes `configuration.events` with the public settings subset and lists `EVENTS` in `modules`. Otherwise Event settings are omitted.
