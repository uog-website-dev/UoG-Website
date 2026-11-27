# Event registration and participants API

Optional visitor registration for published Events with capacity and waitlist controls. Site Administrators manage participants, invitations, printable badges, and CSV export. No CMS account is required for attendees.

## Event configuration

| Field | Purpose |
| --- | --- |
| `registration_required` | Enables registration for the Event |
| `registration_open` | Manual open/close switch |
| `registration_opens_at` / `registration_closes_at` | Optional open window |
| `registration_capacity` | Seat limit for PENDING + CONFIRMED + INVITED (`null` = unlimited) |
| `waitlist_enabled` | Accept waitlisted rows when full |
| `registration_category` | Optional public label |
| `registration_required_fields` | `participant_name`, `email`, plus optional `organization` / `phone` |
| `registration_notice` | Public notice shown with the form |

Public aggregate state (`registration_state`): `OFF`, `OPEN`, `FULL`, `CLOSED`, `WAITLIST_AVAILABLE`. Public Event and speaker schemas never include participant contact fields.

## Public endpoints

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/site-context/events/{slug}/registrations/` | Create registration. Honeypot field `website` must be blank. Rate limit 10/min per Site visitor. |
| POST | `/api/v1/site-context/events/{slug}/registrations/cancel/` | Cancel with `email` + `management_token`. Unknown pairs return 404 without revealing existence. |

Receipts return `status`, `management_token`, `waitlist_position`, and `notification_status` only — never other registrants’ emails.

## Capacity and waitlist

Creates run under `SELECT … FOR UPDATE` on the Event row:

1. Under capacity → `CONFIRMED` (public) or `INVITED` / `CONFIRMED` (admin)
2. Full + waitlist → `WAITLISTED`
3. Full without waitlist → `409`
4. Duplicate active email → `409`
5. Closed/cancelled/draft/unpublished → rejected for public creates

Cancellation (public or admin) releases a seat-holding status and promotes the oldest waitlisted registration without exceeding capacity or duplicating seats.

## Participant display categories

`display_category` is one of `PARTICIPANT`, `SPEAKER`, `VIP`, `MODERATOR`, `ORGANIZER`. Changing category does **not** create or alter `EventPerson` / session speaker assignments. Contact data on registrations is separate from public speaker profiles.

## Admin endpoints (Site Administrator + Events module)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/sites/{site_id}/events/{event_id}/registrations/` | Paginated list with `status`, `category`, `search`, `page`, `page_size` |
| POST | `/api/v1/sites/{site_id}/events/{event_id}/registrations/` | Manual `invite` (`INVITED`) or `register` (`CONFIRMED`/`WAITLISTED`) |
| GET/PATCH/POST | `.../registrations/{id}/` | Detail, category/contact update, `confirm` / `cancel` / `delete` actions |
| GET | `.../registrations/{id}/badge/` | Printable badge fields only; reprint keeps the same `check_in_token` |
| GET | `.../registrations/export/` | CSV of approved fields with formula-injection neutralization |

Unauthorized callers (anonymous or other Sites) receive `401`/`403`/`404`. Badge and list endpoints are never public.

### Badge fields

`event_title`, `participant_name`, `display_category`, `check_in_token`. No email, phone, or other PII by default.

### CSV export fields

`id`, `participant_name`, `email`, `organization`, `status`, `display_category`, `source`, `waitlist_position`, `created_at`, `confirmed_at`, `cancelled_at`.

Cells starting with `=`, `+`, `-`, `@`, tab, or CR are prefixed with `'` to neutralize spreadsheet formula injection. Exports and badge views are audit-logged.

## Retention and deletion

Admin `delete` soft-deletes (`deleted_at` set, status `CANCELLED`). Soft-deleted rows are excluded from active email uniqueness, capacity, lists, badges, and CSV. Hard purge is an operations task outside the product UI. Audit records retain administrative create/update/export/badge actions.

## Notifications

`notification_status` is `NOT_CONFIGURED` unless `EVENT_REGISTRATION_NOTIFY_ENABLED` and a callable `EVENT_REGISTRATION_NOTIFY_BACKEND` are set. Delivery is never fabricated as `SENT` when unconfigured or when the backend raises.
