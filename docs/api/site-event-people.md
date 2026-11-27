# Site Event people and session roles API

Event-scoped speaker/moderator profiles live under `/api/v1/sites/{site_pk}/events/{event_id}/people/`. Session role assignments live under `/api/v1/sites/{site_pk}/events/{event_id}/sessions/{session_id}/people/`. Both require the Site `EVENTS` module and Site-scoped `sites.update`.

## People

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/people/` | Searchable active profiles. Includes private email/phone for admins. |
| POST | `/people/` | Create a speaker without registration. Biography is sanitized; public links must be http(s). |
| GET/PATCH/DELETE | `/people/{id}/` | Strong person ETag / `If-Match`. DELETE soft-removes the profile. |

Profiles are independent from registration accounts. `verified_account` is an optional explicit user link and is never inferred from email.

Portrait photos must be ready Site Media Library images. Foreign-Site asset IDs are rejected.

## Session assignments

| Method | Path | Notes |
| --- | --- | --- |
| GET/POST | `/sessions/{id}/people/` | List or assign roles (`SPEAKER`, `MODERATOR`, `PANELIST`, `ORGANIZER`). |
| PATCH/DELETE | `/sessions/{id}/people/{assignment_id}/` | Update role/order or remove the assignment. |
| POST | `/sessions/{id}/people/reorder/` | Transactional assignment order. |

Removing an assignment never deletes the `EventPerson` profile or other session associations. Soft-removed people are omitted from public agenda payloads.

## Public payloads

Public agenda session objects include `people` with ordered public-safe summaries (`display_name`, `affiliation`, `biography`, `profile_photo_url`, `public_links`, `role`). Private email and phone are never included. Hidden people are omitted.

Overlapping sessions that share an assigned person produce speaker conflict warnings (non-blocking), alongside legacy `speaker_labels` overlaps.
