# Event Management — Site-scoped authorization & privacy (P0-EVENT-014)

Event Management uses the existing **Site Administrator** role (`sites.update` on the Site) plus the **EVENTS** module gate. There are no Event-specific management roles. Frontend navigation may hide controls, but every write and private read is enforced server-side.

## Central access helpers

| Helper | Module | Behavior |
| --- | --- | --- |
| `load_site` / `admin_event` / `admin_event_only` | `apps.cms.event_access` | Site exists, EVENTS enabled, actor has `sites.update`, Event belongs to that Site |
| `public_event` | same | Host-resolved Site, EVENTS enabled, Event in the public publication set |
| `owned_child` | same | Nested row bound to parent Event (and Site FK when present) |

All management APIs (Event, Session, EventPerson, Registration, Gallery, Resource, Update, Attendance, bulk/export) call these helpers. Nested parent–child identifier substitution fails closed (404).

## RBAC matrix

| Actor | Management CRUD / export | Public published Event | Draft / private child | Cross-Site ID |
| --- | --- | --- | --- | --- |
| Anonymous | 401/403 | Public-safe serializers only | 404 | 404 |
| Authenticated non-admin | 403 | Same as anonymous | 404 | 403/404 |
| Site Admin (Site A) | Allowed on Site A | Allowed | Allowed on Site A | Site B private data denied |
| Site Admin (Site B) | Allowed on Site B | Host-scoped | Site A denied | Site A IDs denied |
| Module EVENTS disabled | Writes/list 403 | Public routes 404 (no metadata leak) | N/A | N/A |

## Public-safe serializers & entitlement

- Organizer email/phone, participant emails/phones, check-in tokens, and attendance rows are never returned on anonymous Event/speaker/gallery endpoints.
- Registered-only resources require a verifiable registration entitlement (email + management token) and a short-lived download grant (`GRANT_TTL_SECONDS`). Unpublish/revoke invalidates further use of prior grants.
- Draft gallery images, draft resources, draft updates, and draft Events are not publicly enumerable.

## Files & object URLs

- Uploads go through Documents/Media with MIME/extension checks and malware/quarantine gates before Event association.
- Serving uses app-mediated download routes with `Cache-Control: private, no-store` — direct object-storage URLs are not issued as long-lived public links.
- Quarantined or non-READY assets cannot be attached or downloaded.

## Registration abuse controls

- Honeypot field `website` must be blank.
- Origin must match Host when Origin is present.
- Body size capped; server-side field validation.
- `RegistrationThrottle`: 10/min per Site visitor (IP hashed with Site id).

## Attendee personal data — policy decisions

| Decision | Choice |
| --- | --- |
| Collected fields | `participant_name`, `email`, optional `organization` / `phone` when required by Event settings |
| Consent | Explicit `consent` boolean recorded with `consent_at`; notice text optional |
| Public exposure | None — receipts return status + management token only |
| Badge | Name, category, opaque check-in token — no email/phone |
| CSV export columns | Fixed allowlist (`CSV_EXPORT_FIELDS`); excludes phone by default |
| Formula injection | Cells neutralized before export |
| Soft delete | Retains row for audit/retention; excluded from active lists/exports |
| Retention | Soft-deleted participant rows retained for operational audit; hard purge is out of band |
| Export audit | `EVENT_PARTICIPANT_CSV_EXPORTED` / `EVENT_ATTENDANCE_REPORT_EXPORTED` with actor, Site, Event, timestamp |

## Audit

`record_event` captures actor (from request audit context), action, entity type/id, timestamp, and domain `after` snapshots that include Site for exports and sensitive views.

## Module disablement

Disabling EVENTS blocks management writes/lists (403) and hides public Event surfaces (404) without deleting stored Event records. Re-enabling restores access under the same Site Admin + publication rules.

## Related evidence

- Automated matrix: `apps/cms/tests/test_event_security_matrix.py`
- Per-feature IDOR suites: sessions, people, registrations, resources, gallery, updates, attendance
