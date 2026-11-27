# Event registration API

Optional visitor registration for published Events with capacity and waitlist controls. No CMS account is required.

## Event configuration

| Field | Purpose |
| --- | --- |
| `registration_required` | Enables registration for the Event |
| `registration_open` | Manual open/close switch |
| `registration_opens_at` / `registration_closes_at` | Optional open window |
| `registration_capacity` | Confirmed seat limit (`null` = unlimited) |
| `waitlist_enabled` | Accept waitlisted rows when full |
| `registration_category` | Optional public label |
| `registration_required_fields` | `participant_name`, `email`, plus optional `organization` / `phone` |
| `registration_notice` | Public notice shown with the form |

Public aggregate state (`registration_state`): `OFF`, `OPEN`, `FULL`, `CLOSED`, `WAITLIST_AVAILABLE`.

## Public endpoints

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/site-context/events/{slug}/registrations/` | Create registration. Honeypot field `website` must be blank. Rate limit 10/min per Site visitor. |
| POST | `/api/v1/site-context/events/{slug}/registrations/cancel/` | Cancel with `email` + `management_token`. Unknown pairs return 404 without revealing existence. |

Receipts return `status`, `management_token`, `waitlist_position`, and `notification_status` only — never other registrants’ emails.

## Capacity and waitlist

Creates run under `SELECT … FOR UPDATE` on the Event row:

1. Under capacity → `CONFIRMED`
2. Full + waitlist → `WAITLISTED`
3. Full without waitlist → `409`
4. Duplicate active email → `409`
5. Closed/cancelled/draft/unpublished → rejected

Cancellation releases a confirmed seat and promotes the oldest waitlisted registration without exceeding capacity.

## Notifications

`notification_status` is `NOT_CONFIGURED` unless `EVENT_REGISTRATION_NOTIFY_ENABLED` and a callable `EVENT_REGISTRATION_NOTIFY_BACKEND` are set. Delivery is never fabricated as `SENT` when unconfigured or when the backend raises.

## Admin

`GET /api/v1/sites/{site_id}/events/{event_id}/registrations/` — Site Administrator inventory with summary counts (private).
