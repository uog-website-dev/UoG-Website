# Event attendance & reports

Site Administrators record attendance against `EventRegistration` rows and review private outcome metrics. Offline check-in synchronization is **out of scope**.

## Attendance model

| Field | Notes |
| --- | --- |
| `registration` | OneToOne — one attendance row per participant |
| `checked_in_at` / `checked_out_at` | Check-out optional |
| `method` | `MANUAL`, `QR`, or `OVERRIDE` |
| `operator` | Acting Site Admin |
| `notes` | Optional short note |

Replays of the same registration/token return the existing row (`replayed: true`, HTTP 200) and do not inflate totals. Concurrency uses `select_for_update`.

## Check-in eligibility

| Status | Allowed |
| --- | --- |
| `CONFIRMED`, `INVITED` | Manual or QR |
| `CANCELLED` | Only with `override: true` (method `OVERRIDE`) |
| Other / deleted | Rejected |

## QR / token validation

Badges include:

- opaque `check_in_token` (per-Event unique)
- signed `qr_payload` binding `{event_id, check_in_token}`

`POST …/attendance/scan/` accepts either form. Tokens for another Event, tampered signatures, or unknown tokens are rejected. Public Event APIs never return tokens, emails, or attendance rows.

## Admin APIs

| Method | Path |
| --- | --- |
| GET | `/api/v1/sites/{site}/events/{event}/attendance/` |
| POST | `…/attendance/check-in/` |
| POST | `…/attendance/scan/` |
| POST | `…/attendance/{registration}/check-out/` |
| GET | `…/report/` |
| GET | `…/report/export/` |

Requires Site Administrator + EVENTS. Cross-Site access is denied.

## Reports

Metrics distinguish registrations, confirmed, waitlisted, cancelled, attended, capacity, seats remaining, and capacity utilization, plus category breakdown. Filters: `status`, `category`, `attended`, `date_from`, `date_to`.

CSV export reuses formula-injection neutralization and is audit-logged (`EVENT_ATTENDANCE_REPORT_EXPORTED`). Personal fields are limited to the approved report columns.
