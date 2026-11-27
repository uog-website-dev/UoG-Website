# Cache & recovery smoke checklist

| Check | Expected | Status |
| --- | --- | --- |
| Publish Event update | Public `/updates/` returns row within freshness policy; `Cache-Control` includes `max-age=30`; `X-Events-Cache-Freshness-Seconds: 30` | Covered by release pilot test |
| Schedule session change | Public agenda reflects change; `EventSessionRevision` + `EVENT_SESSION_UPDATED` audit exist | Covered by release pilot test |
| Mid-event gallery/resource publish | Public sections flip without Event root republish | Covered by release pilot test |
| Module disable | Public Host routes 404; admin writes 403; rows retained | Covered by release pilot test |
| Registration entitlement revoke | Unpublish registered-only resource → prior grant fails | Covered by resource suite (EVENT-009) |
| DB backup restore (infra) | Staging restore serves Event list/detail and accepts one test registration | **Manual with infrastructure** — record result in `acceptance-results.json` |
