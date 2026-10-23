# Organization lifecycle implementation and evidence

Policy: [organization lifecycle rules](../architecture/organization-lifecycle-rules.md).
The required names, normalized code uniqueness, type/parent integrity and
cycle checks continue to apply to all states.

```python
from apps.organizations.services.lifecycle import (
    deactivate_unit, archive_unit, transition_unit, delete_unit,
)

deactivate_unit(unit_id)  # Requires no active descendants or linked active Sites.
archive_unit(unit_id)     # Requires INACTIVE; references and children remain.
```

The lifecycle is forward-only: ACTIVE → INACTIVE → ARCHIVED. New units start
ACTIVE. Root is the single ACTIVE UNIVERSITY unit and cannot be retired,
moved or retyped. Direct model saves enforce these rules too. `delete_unit`
always rejects destructive deletion; it is provided as an explicit policy
boundary. Transaction groups can use an outer `transaction.atomic()`.

Use Django admin's status field for authorized administrative transitions;
there is no Organization REST API in this story. Status updates are not
dependent on frontend behavior. Backend/domain validation and PostgreSQL
triggers/constraints remain authoritative.

`organizations.0005_lifecycle_rules` adds ARCHIVED, the root-active check,
root/transition/reference validation functions, the Site hook and a lifecycle
trigger. Previous migrations are unchanged. Refer to the policy for legacy
data preflight and downgrade restrictions.

```console
docker compose exec backend /app/entrypoint.sh python manage.py check
docker compose exec backend python manage.py migrate --check
docker compose exec backend pytest
docker compose exec backend python manage.py makemigrations --check --dry-run
docker compose exec backend python manage.py spectacular --file /tmp/openapi.yaml --validate --fail-on-warn
```

## Completion evidence (2026-10-23)

| Evidence | Result |
| --- | --- |
| Migration | `organizations.0005_lifecycle_rules` applied in Docker as `uog_migrate`; all five organization migrations marked applied. |
| Full backend suite | **172 passed in 26.87s**, including 23 new lifecycle cases and previous type, hierarchy, platform, identity and Swagger tests. |
| Root/integrity rules | Invalid root type/status, second UNIVERSITY root, root movement/retyping, primary-key changes and destructive deletion rejected; existing uniqueness, required-field and FK tests pass. |
| Lifecycle rules | Forward transitions, rejected skips/reversals, bottom-up descendant deactivation, non-cascading parent archival and archived structural restrictions verified. |
| Historical references | Linked consumer rows retained after archival; raw SQL deletion rejected even with an ON DELETE CASCADE consumer FK. |
| Site contract | Active Site links veto deactivation/archive, including a legacy link on an inactive descendant; inactive links retained. Missing conventional Site wiring fails closed. Tests use a real SQL FK fixture, not a production Site model. |
| Concurrent dependencies | Two independent-connection races verify deactivation versus active-child insertion and deactivation versus active-Site linking. Exactly one operation commits; the other receives the expected validation/integrity error. |
| Legacy migration safety | Invalid historical root or inactive-parent/active-child state rejects the upgrade without rewriting records; existing hierarchy migration safety tests continue to pass. |
| Migration/schema checks | No model drift; `migrate --check` exit 0; OpenAPI validation with warnings treated as failures exit 0. No REST operations added. |
| Runtime permissions | `uog_app` successfully verifies root protection and ACTIVE → INACTIVE → ARCHIVED, and rejects SQL deletion. Verification rows were rolled back. |
| Startup | Django check: no issues. Live liveness, readiness and Swagger: HTTP 200. |
| Hosted CI | Pending; existing Azure pytest step discovers these tests, but no hosted result has been verified for this working tree. |
| Merged PR/commit | Pending; attach the actual merged story reference before closure. |

No unintended backend regression was detected. Earlier permissive behavior
is deliberately superseded: non-University roots, root deactivation,
reactivation and unit deletion are no longer allowed. Concrete Site schema/
API integration remains a subsequent domain story and must wire the tested
hook/serialization protocol before being considered covered in production.
