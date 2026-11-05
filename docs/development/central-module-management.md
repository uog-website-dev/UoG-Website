# Central module management

Open Platform Administration → Modules. Registry, Site module management and
History use the existing Admin Console components. Site-only users cannot use
this console; their delegated Site controls remain separate.

The backend reuses `platform.sites.manage_registry`, an existing platform-scoped
permission. No new role, token claim or Django staff bypass grants central access.
The existing development write policy also applies: bulk apply requires both
`DEBUG` and `ORGANIZATIONS_DEV_WRITES_ENABLED`. Preview and history remain readable
to authorized administrators while that write gate is closed. This feature does
not authorize a production write release.

## Workflow and API

1. Choose modules and a scope: one Site, selected Sites, all Sites, all matching
   filtered Sites, or an Organization with explicit descendant inclusion.
2. Preview and review eligible, unchanged and blocked Site-module pairs. Selection
   of the visible page is distinct from all matching Sites across pagination.
3. Confirm; high-impact operations require a reason and a typed action phrase.
4. Inspect the committed result and History. No success is shown before commit.

| Endpoint under `/api/v1/` | Purpose |
| --- | --- |
| `modules/` | Existing registry |
| `modules/activation-summary/` | Availability, activation counts, eligibility and dependencies |
| `site-modules/` | Filterable, paginated activation inventory |
| `site-modules/bulk-preview/` | POST action/modules/scope, returning the signed preview |
| `site-modules/bulk-apply/` | POST preview token, reason and confirmation with UUID `Idempotency-Key` |
| `site-modules/operations/` | Paginated operation history |
| `site-modules/operations/{uuid}/` | Operation and individual changes |

See [OpenAPI](../api/openapi.yaml) and [the error catalog](../api/error-catalog.md).
Unknown request fields, conflicting scope fields, unknown module filters and
repeated query values are rejected rather than silently widening the scope.

## Consistency, dependencies and retained data

`SiteModule.is_enabled` remains the only activation state. Preview creates no
operation or assignment records. It reads under the common transactional guard
so scope, versions, configuration, implementation registry and dependency graph
agree. Apply acquires that guard before row locks, rechecks platform permission,
and compares the current snapshot with the signed preview (15-minute validity).
Configuration/schema changes, dependency changes, target changes and ownership
or lifecycle changes require a fresh preview. Eligible pairs commit together;
previously blocked pairs are explicitly skipped as shown in the preview.

Completed requests replay with the same actor, key, token and reason, even after
preview expiry. A reused key with a different request returns a conflict. A new
operation always requires a valid preview. An uncertain frontend retry retains
the exact submitted body and key; edit controls remain locked until its result
is known or the operator cancels.

Individual Site switches use the same guard, dependency validation and durable
audit writer. PostgreSQL additionally rejects dependency cycles, invalid direct
activation/disable writes and archived Site switches. Dependency insertion cannot
invalidate existing enabled Site assignments. Dependencies are never activated
or disabled implicitly. Required modules selected explicitly in the same operation
are enabled first; dependents are disabled first.

Effective module availability checks transitive dependencies too. A globally
unavailable requirement removes dependent capabilities from Site navigation and
delivery without deleting assignments. Disabling preserves configuration,
Pages/Posts/Menus, publication states and history. Existing Site/public endpoint
policies continue to enforce authorization, active Site resolution and module
availability. Re-enabling restores access according to those policies.

Operation history is append-only in PostgreSQL. Each committed state transition
records actor/system context, Site, module, before/after, operation, scope, reason
and correlation ID through the shared audit contract. Audit failure rolls back
the business transaction. Rejections are recorded after rollback without raw
request bodies, preview tokens or arbitrary headers.

Migration `sites.0008_module_operations` adds dependency/history records;
`sites.0009_module_integrity` adds serialization and integrity triggers. Run
migrations using the configured migration role, never the runtime application
role. Keep developer volumes intact.
