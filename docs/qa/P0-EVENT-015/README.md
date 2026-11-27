# P0-EVENT-015 — Event release validation evidence

Release gate for University Main + pilot college Event Management.

## Artifacts

| File | Purpose |
| --- | --- |
| [GO-NO-GO.md](GO-NO-GO.md) | Formal decision and conditions |
| [ROLLBACK.md](ROLLBACK.md) | Module/content/cache recovery notes |
| [cache-recovery-smoke.md](cache-recovery-smoke.md) | Cache + backup smoke checklist |
| [acceptance-results.json](acceptance-results.json) | Machine-readable gate results |
| [backend-tests.txt](backend-tests.txt) / [backend-tests.xml](backend-tests.xml) | Event API/integration suite |
| [admin-event-ui-tests.txt](admin-event-ui-tests.txt) | Admin Events nav/RBAC |
| [public-event-ui-tests.txt](public-event-ui-tests.txt) | Public detail a11y landmarks |
| [public-typecheck.txt](public-typecheck.txt) | public-web TypeScript |

## How to reproduce

```bash
# Backend release + security suites
pytest apps/cms/tests/test_event_release_pilot.py \
  apps/cms/tests/test_event_security_matrix.py \
  apps/cms/tests/test_events_api.py \
  apps/cms/tests/test_public_events_calendar.py \
  apps/cms/tests/test_public_event_detail.py \
  apps/cms/tests/test_event_registrations.py \
  apps/cms/tests/test_event_resources.py \
  apps/cms/tests/test_event_gallery.py \
  apps/cms/tests/test_event_updates.py \
  apps/cms/tests/test_event_sessions_api.py \
  apps/cms/tests/test_event_people_api.py \
  apps/cms/tests/test_event_navigation_widgets.py -q

# Optional ops seed
python manage.py seed_event_pilot --site-code <CODE>
```

API summary: [event-release-gate.md](../../api/event-release-gate.md).
Privacy/RBAC: [event-security-privacy.md](../../api/event-security-privacy.md).

## Linked work

- Base: `P0-EVENT-014` (`148492d`)
- Compare PR: `P0-EVENT-014...P0-EVENT-015`
