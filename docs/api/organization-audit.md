# Organization audit events

OrganizationUnit uses the [shared audit contract](../architecture/audit-contract.md).
Every committed INSERT/UPDATE is audited by a PostgreSQL trigger through
the platform common writer. API, Django admin, direct model saves, services,
queryset update/bulk operations and raw SQL share this behavior. Reads and
disallowed destructive deletion do not generate success events.

| Significant change | Event |
| --- | --- |
| New unit | ORGANIZATION_CREATED |
| Name, short name, type, description or metadata change | ORGANIZATION_UPDATED |
| Parent change | ORGANIZATION_MOVED |
| Status becomes INACTIVE | ORGANIZATION_DEACTIVATED |
| Status becomes ARCHIVED | ORGANIZATION_ARCHIVED |
| Status becomes ACTIVE | ORGANIZATION_ACTIVATED, reserved for a future approved activation transition |

The current lifecycle remains ACTIVE → INACTIVE → ARCHIVED. Creation is
ACTIVE and emits CREATED only; reactivation remains prohibited and does not
generate a false ACTIVATED event. A name-plus-parent PATCH emits UPDATED and
MOVED with the same actual row before/after snapshots. Timestamp-only/no-op
saves emit no event. Parent/status-only operations use their specific actions
rather than an additional generic UPDATED event.

Entity type is `organizations.organizationunit`; entity ID is the unit PK
as a string. Authenticated requests record the stable local actor ID,
validated request/correlation UUID and direct peer IP. Commands without
context record `SYSTEM/system`; jobs can supply a named system identity.
Context values are not accepted from Organization payloads or actor headers.

Snapshots contain `id`, `code`, `name`, `short_name`, `organization_type_id`,
`parent_id`, `status`, `created_at`, `updated_at`. Description and metadata
values are **excluded**, since they can contain arbitrary sensitive text.
Their changes still generate UPDATED with the corresponding names in
`changed_fields`. The common writer additionally performs recursive
credential-key redaction. Type/parent identifiers are preserved for historical
traceability without adding destructive audit foreign keys.

Database-trigger auditing captures actual persisted values, including
`update_fields`, SQL expressions and bulk operations. It does not rely on
possibly stale Python instances, UI input or HTTP-only hooks. Trigger and
business mutation share a transaction: storage failure prevents the change
from committing. A transaction rolled back by its caller leaves neither
the Organization change nor its events. Existing hierarchy serialization,
cycle/root rules and lifecycle restrictions remain enforced.

An audit-write failure on an Organization POST/PATCH/lifecycle operation
returns the standard **503 service_unavailable** envelope with request ID.
No SQL/storage detail is exposed. The change was rolled back; restore audit
storage before retrying. Usual permission, 400 validation, 409 conflict and
412/428 conditional-write contracts still apply. OpenAPI documents the 503
response; there is no additional audit REST endpoint in this story.

Investigate via the read-only AuditEvent Django admin viewer using the
normal staff/model-view permissions, or authorized server-side selectors:

```python
from apps.audit.models import AuditEvent

AuditEvent.objects.filter(
    entity_type="organizations.organizationunit", entity_id=str(unit_id)
).order_by("timestamp", "id")
```

Migrations: `audit.0001_initial`, `audit.0002_common_writer`,
`organizations.0006_audit_events`. Existing units are not backfilled with
invented historical creation events. The migration installs auditing for
subsequent changes. OrganizationType lookup edits and other domains require
their own domain action/snapshot mapping to the same shared writer.

Tests: `backend/tests/test_audit.py` and
`backend/tests/test_organization_audit.py` cover common persistence/redaction,
actor/system identities, create/update/move/lifecycle, admin/API/bulk/raw SQL,
no-ops, rejected reactivation, append-only enforcement and rollback/failure.
Run the entire regression suite with
`docker compose exec -T backend pytest -o addopts='' -q`.
Hosted CI and merged PR/commit evidence remain pending until push/review;
local tests do not establish those remote results.

## Local verification (2026-10-23)

- Complete PostgreSQL-backed Docker regression suite:
  **313 passed in 82.58s** (`pytest -o addopts='' -q`), including 20 new audit
  contract/domain cases and all earlier story tests. No regression detected.
- Fresh test database migrations and live Docker migrations succeeded:
  `audit.0001_initial`, `audit.0002_common_writer`,
  `organizations.0006_audit_events`. Earlier hierarchy/lifecycle migration
  rollback tests now restore the latest Organization migration.
- `manage.py check`, `makemigrations --check --dry-run` and
  `migrate --check`: exit 0. No pending model or migration changes.
- OpenAPI validation with `DEBUG=False` and warnings treated as failures:
  exit 0; generated schema matches [the repository snapshot](openapi.yaml).
  Organization mutations document the sanitized transactional 503 response.
- Running application role has the required audit SELECT/INSERT privileges;
  Docker services remain healthy where health checks exist. Health, Swagger
  and schema return 200 through Nginx; anonymous Organization access is 401.
- Audit storage failures were injected with a PostgreSQL INSERT trigger:
  domain changes rolled back, failed creates left no unit/event, and HTTP
  responses returned 503 without the injected storage secret.
- Hosted pipeline result and merged PR/commit remain pending. The existing
  CI job will run these tests and validate/publish the updated schema after
  push; this evidence does not claim a remote CI or merge result.
