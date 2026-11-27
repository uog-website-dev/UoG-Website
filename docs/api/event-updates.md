# Event updates & session revisions

Site Administrators publish timely Event notices and controlled agenda changes without republishing the root Event. Drafts stay private. Public APIs never return unpublished updates or admin audit fields. This feature does **not** send email, SMS, or push notifications.

## Update model

| Field | Notes |
| --- | --- |
| `title` / `body` | Title is plain text; body is sanitized rich HTML (`nh3`) |
| `severity` | `INFO`, `IMPORTANT`, `URGENT` |
| `status` | `DRAFT`, `PUBLISHED`, `UNPUBLISHED` — independent of Event root |
| `pinned` | Prefer Overview prominence with IMPORTANT/URGENT |
| `published_at` / `unpublished_at` | Set on publish/unpublish |
| `version` | Optimistic concurrency for edit and action endpoints |

## Admin APIs

| Method | Path |
| --- | --- |
| GET/POST | `/api/v1/sites/{site}/events/{event}/updates/` |
| PATCH | `…/updates/{id}/` |
| POST | `…/updates/{id}/action/` (`publish` \| `unpublish`) |
| GET | `…/sessions/{session}/revisions/` |

Requires Site Administrator + EVENTS. Cross-Site Event IDs are rejected (403/404). Publishing an update does not bump the Event root version.

## Public APIs

| Method | Path | Cache |
| --- | --- | --- |
| GET | `/api/v1/site-context/events/{slug}/updates/` | `public, max-age=30, must-revalidate` |
| GET | `/api/v1/site-context/events/{slug}/notices/` | same |
| GET | Event detail `sections.updates` + `notices[]` | Event detail policy |

Ordering: pinned first, then `published_at` descending. Public payloads omit `status`, `version`, `created_by`, `updated_by`, and `event`.

Freshness target: clients and CDN revalidate within **30 seconds** (`X-Events-Cache-Freshness-Seconds: 30`, ETag on updates/notices).

## Session revisions

Controlled edits to published sessions (time, venue, status) still run schedule validation. Successful changes append an `EventSessionRevision` row with before/after snapshots, changed fields, actor, and timestamp. Invalid times or out-of-range windows return 400 and write no revision.

## Security

- XSS: titles strip tags; bodies pass `sanitize_rich_text`.
- Public serializers never expose drafts or private metadata.
- Site-scoped RBAC: a Site Admin cannot publish notices for another Site’s Event.
- No UI or API claims that email/push/SMS was sent.
