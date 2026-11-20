# P4-HOME-004 — Publish and restore homepage verification

## Evidence

| Check | Result |
| --- | --- |
| Homepage Settings shows the effective published root and pending template draft | Browser PASS |
| Pending draft is not served to anonymous visitors | Browser PASS against the public homepage API |
| Restore an older revision through the Pages UI | Browser PASS; restore creates a new editable revision |
| Restore an earlier homepage revision, republish it and retain the source history | Backend integration PASS |
| Restoring a draft leaves the live homepage assignment unchanged | Browser PASS |
| Publish an approved Page, assign it to Site A, and verify Site B is unchanged | Browser PASS |
| Site-scoped publication, assignment, authorization, conflict and revision API regressions | Backend tests PASS |
| Homepage Settings and Page revision components | 33 component tests PASS |
| Revision server-action path, ETag and response contract | 9 page-action tests PASS |
| Admin TypeScript | PASS |

The combined frontend run passed 42 tests across the Page action, Homepage
Settings and Page workflow suites. The backend regression run covering
homepage assignment, public root resolution, revision APIs, restore services,
Page workflows and widget runtime completed successfully; the focused final
assignment and revision run completed successfully with the restore-and-republish
regression included.

There is no migration for this change. Site A/Site B isolation, atomic
assignment, public draft exclusion, module gates and failed assignment
behavior use the existing backend contracts and their regression tests. The
browser rehearsal verifies pending-draft visibility, revision recovery and
the anonymous public root; role denials and injected failure cases are
verified at the API/service layer.
