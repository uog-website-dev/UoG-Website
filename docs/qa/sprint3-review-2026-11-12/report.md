# Sprint 3 review — current decision

**NO-GO for Sprint acceptance. Reviewer signatures remain unsigned.**

This supersedes the earlier conditional-go assessment, retained in
[historical-previous-review](historical-previous-review/). That mocked
release-path test was not real MinIO/Celery/Next.js E2E evidence.

| Check | Actual result |
| --- | --- |
| Real Keycloak → nginx/Django → MinIO → Celery → publication/homepage APIs | PASS: 80 recorded checks, eight scoped profiles, two isolated review Sites |
| Negative/API/media/contract regression | 162 passed |
| Local OpenAPI validation/documentation | 14 passed; baseline comparison FAIL |
| Shared renderer and capability instrumentation | 73 passed; eight required runtime widgets unavailable |
| Public-web production build | PASS |
| Admin-web production build and workspace TypeScript | FAIL: inspector type errors |
| Browser hydration, picker, dashboard and configured provider walkthrough | NOT VERIFIED |
| One frozen source snapshot | FAIL: five frontend files changed during execution |
| Hosted CI run and stakeholder signatures | NOT SUPPLIED / UNSIGNED |

The real run uploaded and processed images through private MinIO and non-eager
Celery, handed off editor/reviewer/publisher/administrator identities, saved and
published a 60/40 Slider Page, assigned its homepage and requested both trusted
Host roots. It checked foreign IDs, private/public eligibility, missing derivative
fallback, disabled/re-enabled Builder access, a real HTTP draft race, deletion
protection and worker cleanup of an unused asset. Medicine's body and cache
generation stayed unchanged through Informatics operations. Next.js returned its
real HTTP shell; this does not prove client hydration.

See [defects.md](defects.md) for exact reproduction and expected/actual outcomes.
Contact Form, taxonomy Loop Grid/filter, Site Logo/Title and Post-context widgets
still return the integration fallback. Valid schemas cannot substitute for those
runtime/provider checks. No release gate was waived.

- [Detailed run and commands](release-audit/report.md)
- [Real-service inputs, IDs and outcomes](release-audit/live-services.json)
- [Build logs, source snapshots and environment](release-audit/)
- [43-widget runtime matrix](release-audit/runtime-matrix.json)
- [Checklist](release-audit/checklist.json) and [unsigned sign-off](release-audit/signoff.json)
- [OpenAPI difference](release-audit/schema-difference.json)
- [Integrity manifest](release-audit/manifest.json) — checksums are not signatures
- [Prototype separation](release-audit/prototype-walkthrough/README.md)

No approval, issue closure, remote CI result, commit or push is claimed.
Generated Keycloak identities are disabled and local accounts deactivated.
Review Sites, revisions and audit rows are retained by their recorded IDs.
See [repeat instructions](README.md).
