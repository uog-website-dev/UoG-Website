Use live canonical Site memberships as the sole CMS authorization source and derive workflow actions from the same gate. Remove legacy content-role management endpoints, model and fallback; migrate fixtures/review scripts to canonical assignments.

Add reviewed reconciliation with capability comparisons, source-state fingerprints, idempotent provenance/audit records and a guarded table-removal migration. Reverse migration restores only still-eligible reviewed grants, preserving IDs/timestamps and preventing revoked-access resurrection. The local inventory retired 73 inactive QA grants without creating memberships.

Backend, migration and real-browser evidence is linked in README.md. Operator guidance describes staged deployment, explicit approval of expansions and controlled rollback. Independent review and Issue association remain pending.
