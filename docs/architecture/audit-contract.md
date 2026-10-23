# Shared audit contract

No P0 common audit writer or failure policy was present in the repository.
This contract implements the minimal reusable infrastructure authorized by
the Organization audit story. It is a platform service, not an Organization
event table or an HTTP-only logger. Other domains can use the same writer
and register their own approved snapshot/event mapping.

Implementation: `backend/apps/audit/`. Durable storage: `audit.AuditEvent` in
the existing shared PostgreSQL database. The Python entry point is
`apps.audit.writer.record_event(...)`; SQL triggers use the same database
function `audit_record_event(action, entity_type, entity_id, before, after,
changed_fields)`. The writer returns the new event's BigAutoField ID.

| Field | Contract |
| --- | --- |
| actor_kind / actor_id | USER plus stable local user PK string, or SYSTEM plus `system`/an explicit trusted task identity |
| action | Stable uppercase machine code, maximum 100 characters |
| entity_type | Stable lowercase dotted domain/model identifier, maximum 100 characters |
| entity_id | Durable string identifier, maximum 255 characters; no destructive FK cascade |
| timestamp | Timezone-aware database `clock_timestamp()` at insertion |
| request_id | Valid UUID when request/task context supplies one; otherwise null |
| ip | Direct peer IP when available, otherwise null |
| before / after | Approved JSON object snapshots or null; creation has before null |
| changed_fields | JSON array of changed field names; no raw values |

Actor IDs deliberately have no user FK. Historical attribution survives user
deletion and renaming. The writer does not store usernames, emails, access
tokens or full OIDC claims. A system event is explicitly identified rather
than left as an ambiguous missing actor. Action/entity names and snapshot
shapes are domain contracts, not data supplied by an HTTP client.

## Context propagation

`AuditContextMiddleware` runs inside the request-ID middleware and uses a
ContextVar. It resolves the authenticated user at write time, after Django
session or DRF bearer authentication. API callers cannot override actor
identity using payloads or headers. Request-ID middleware validates or
replaces the correlation UUID. IP uses `REMOTE_ADDR`; untrusted forwarded IP
headers are ignored. Behind Nginx this may identify the proxy. A future
trusted-proxy policy must be configured explicitly before attributing a
forwarded client address.

Tasks/commands should establish a trusted context:

```python
from apps.audit.context import audit_context
from apps.audit.writer import record_event

with audit_context(actor_id="job:directory-sync", request_id=correlation_uuid):
    record_event(
        action="DIRECTORY_SYNC_COMPLETED",
        entity_type="directory.sync",
        entity_id=run_id,
        after={"records_processed": count},
        changed_fields=["records_processed"],
    )
```

Default context is `SYSTEM/system` with no request ID/IP. Context is reset
on success and failure. Transaction-local PostgreSQL settings carry it to
SQL writers and are restored on nested success or rollback, preventing
leakage through reused connections. Organization save/service/bulk mutation
boundaries bind this context automatically. Trusted direct SQL callers must
wrap their same-connection transaction in
`apps.audit.context.database_audit_context(using=...)` to carry Python
context; otherwise SQL changes remain audited as `SYSTEM/system`.
For another domain, wrap business mutation and `record_event` in the same
`transaction.atomic(using=...)`, using the same database alias.

## Sanitization and persistence

Each domain must pass an explicit allowlist of approved snapshot fields.
Never pass raw requests, credential objects or arbitrary metadata wholesale.
The common SQL writer additionally redacts case-insensitive key names
containing password, secret, token, authorization, cookie, credential,
private-key or session markers, recursively through objects/arrays.
This key-based defense is not a general secret/PII detector for arbitrary
strings; domain snapshot allowlists remain essential. The combined snapshot
and changed-field input is limited to 64 KiB; invalid/oversized events fail
the mutation rather than being silently truncated or dropped.

Events are inserted synchronously in the **same database transaction** as
the business mutation. There is no `on_commit` callback, best-effort log,
separate database or asynchronous broker dependency. SQL errors propagate;
the common function marks audit-write failures as `audit_write_failed` and
rolls back the enclosing statement/transaction. The domain must never catch
that failure and commit an unaudited change. HTTP Organization writes report
a sanitized 503 `service_unavailable`; internal SQL/error contents are not
returned. Admin/command operations propagate failure and roll back as well.
Unexpected unrelated failures retain existing server-error behavior.

No-op saves/timestamp-only changes do not produce domain events. Rejected
commands and rolled-back transactions do not leave misleading success
events. Sequence gaps are normal after rolled-back inserts and are not
evidence of missing committed events. Multi-action changes may produce
several records sharing entity/request identifiers and snapshots.

## Read access, immutability and operations

Audit has no new public REST endpoint. Existing Django admin provides a
read-only AuditEvent viewer, subject to normal active staff and model view
permissions; add/change/delete are disabled. Python model saves/deletes are
disabled in favor of the writer. Database triggers reject UPDATE and DELETE,
including queryset/raw SQL paths. A TRUNCATE trigger rejects application
roles, while allowing the schema owner to perform privileged database
maintenance (also used by isolated test-database cleanup). Entity/time and
request-ID indexes support investigation.

This is append-only application auditing, not a cryptographically sealed
ledger or defense against a privileged DBA/schema owner. The application
database role remains trusted infrastructure; no claim is made that a
compromised SQL client cannot forge an INSERT or session context. Retention,
export, legal-hold and cryptographic sealing are separate policy decisions;
this story adds no purge workflow. Audit backups follow the existing shared
database backup policy.

Migrations `audit.0001_initial`, `audit.0002_common_writer`, then
`organizations.0006_audit_events` must run with the project's migration role
before serving the updated application. Applying the Organization trigger
migration locks Organization writers while installing the trigger; existing
records are not backfilled with invented creation/actor history. Prior
changes can be audited only if a separate historical source supplies real
evidence.
