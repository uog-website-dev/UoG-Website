# Site homepage verification

The [assignment and fallback policy](../../architecture/site-homepage.md) and
[OpenAPI](../../api/openapi.yaml) describe the scoped endpoint and read-only Site
setting. Verification uses real PostgreSQL transactions, host resolution and
published snapshots with isolated cache/storage fixtures.

## Evidence

- [Backend regression](backend.xml): assignment, Page API/serialization, legacy
  homepage compatibility, Site administration, visual publication and schema.
- [Final API and transaction regression](final.xml): final empty-object request
  validation, old/new audit IDs, idempotency, fallback response headers, schema,
  Page API, upgrade and real assignment/unpublication race.
- [Admin component regression](admin.xml): published-only, backend-authorized
  assignment control and existing Page actions.

The broad backend run passed 110 tests, the final API/transaction run passed
32, and the admin run passed 31, all with zero failures. Workspace TypeScript
passed across all five checked packages. The migration applied locally, with
no model drift and no Django system-check issues. OpenAPI validates with warnings
treated as failures.

The two-host scenario warms Informatics and Medicine roots, assigns Informatics'
published 60/40 visual Page, and compares the returned tree with its approved
snapshot. It verifies the revision and snapshot are unchanged, draft/foreign
IDs cannot replace the assignment, and Medicine's body and cache generation
remain unchanged. Unpublishing the selected Page returns the empty-root 404;
the prior legacy homepage and private draft are not substituted. Medicine
continues to return its existing publication and generation.

The permission/module scenario denies an ungranted identity, a Site A
administrator attempting Site B, disabled PAGES and direct queryset assignment.
The audit assertion checks the Site event's actor and new UUID. Fault injection
rolls back assignment, generation and audit together.

A real two-connection race serializes assignment against unpublication. Either
the now-ineligible assignment is rejected, or the accepted assignment remains
configured and serves the fallback after unpublication. A migration rehearsal
reverses the new Site setting, upgrades existing flagged publications and
requests both roots again. Clean-database creation is included in the backend
regression run.

Workspace TypeScript, Django system checks, migration drift and OpenAPI validation
are checked separately. This evidence is API/integration and component coverage;
it does not claim browser automation.
