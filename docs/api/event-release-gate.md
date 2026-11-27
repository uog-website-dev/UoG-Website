# Event Management release gate (P0-EVENT-015)

Validates the complete Event workflow on **University Main** and a **pilot college** Site before P0 release.

## Pilot blueprints

| Blueprint | Helper | Contents |
| --- | --- | --- |
| Research seminar | `build_seminar` / slug `pilot-research-seminar` | Single-day keynote, one speaker, registration |
| Academic symposium | `build_symposium` / slug `pilot-academic-symposium` | Multi-day parallel tracks, speakers, hybrid format |

Seed drafts (ops/rehearsal):

```bash
python manage.py seed_event_pilot --site-code MAIN
python manage.py seed_event_pilot --site-code COLLEGE --publish --actor-username site-admin
```

Automated release gate: `apps/cms/tests/test_event_release_pilot.py`.

## Acceptance coverage

| Criterion | Verification |
| --- | --- |
| Main + college publish Site-owned Events | Release pilot test publish actions |
| Main aggregates only eligible published Events | Aggregation assertions; non-eligible college excluded |
| Calendar, detail, agenda, speakers | Public Host-routed GETs |
| Concurrent last-seat capacity | `test_release_concurrent_last_seat_capacity` |
| Mid-event resources/gallery without root republish | Version stable after child publish |
| Registered-only entitlement | Anonymous denied; grant after registration |
| Schedule change + update freshness | Session revision + audit; `max-age=30` / freshness header |
| No attendee PII in public APIs | Public payload string checks |
| Cross-Site + module toggle negatives | 403/404 matrix |
| Security matrix | `test_event_security_matrix.py` (P0-EVENT-014) |

## Optional P1 scope

Participant badges and attendance reports (P0-EVENT-008 / 013) are optional for initial P0. If included in the same release cut, extend the gate with those suites before Go.

## Evidence pack

See `docs/qa/P0-EVENT-015/` for Go/No-Go, rollback notes, and collected automated results.
