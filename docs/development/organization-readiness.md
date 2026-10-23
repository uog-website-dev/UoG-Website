# Organization backend readiness gate

Validation date: **2026-10-23**. Engineering decision: **PASS as the backend
foundation for Site development** within the scope below.

This gate establishes working backend capability. It does **not** authorize
production Organization writes, claim completed scoped IAM/RBAC, approve an
official institutional registry, or substitute for stakeholder acceptance.
No stakeholder signature, merged PR/commit or hosted CI result was supplied
by this local validation. Those external evidence items remain pending.

## Evidence and source identity

- Complete clean-database run: **317 passed in 91.01s**, zero failures,
  errors or skips. Includes all earlier backend stories and four new
  cross-feature acceptance cases.
- [JUnit results](evidence/organization-readiness.junit.xml) and
  [machine-readable gate summary](evidence/organization-readiness.json).
- New acceptance workflow:
  [test_organization_readiness.py](../../backend/tests/test_organization_readiness.py).
- Repeatable API-create data:
  [uog-structure.json](../../backend/tests/fixtures/organizations/uog-structure.json).
- Source: uncommitted working tree on `P1-ORG-001`, based on `6b4649e`.
  That base commit is **not** presented as the implementation commit. The
  summary records an LF-normalized SHA-256 fingerprint over 117 backend
  source/test/requirement files, plus a canonical OpenAPI fingerprint.
- No new schema migration is introduced by this validation story. The
  required graph includes Organizations `0001`–`0006_audit_events` and Audit
  `0001_initial`–`0002_common_writer`, plus earlier platform migrations.

## Representative UoG structure

The test creates these eight units through the restricted REST API:

```text
University of Gondar [UOG, UNIVERSITY]
├── College of Informatics [CI, COLLEGE]
│   ├── Computer Science [CS, DEPARTMENT]
│   └── Information Systems [IS, DEPARTMENT]
├── College of Medicine [CM, COLLEGE]
├── Research Center [RC, RESEARCH_CENTER]
├── Library [LIBRARY, DIRECTORATE]
└── Registrar [REGISTRAR, ADMINISTRATIVE_UNIT]
```

Library/Registrar classifications are illustrative test assignments proving
directorate/administrative-unit support; they do not assert an official UoG
classification. All records use OrganizationUnit and the managed type lookup,
with no College/Department tables or website-specific fields. The fixture is
not a `loaddata` production seed: the test resolves parent codes to newly
created IDs and POSTs each record in dependency order.

Test records and the reference-consumer table live only in the disposable
PostgreSQL test database/rollback scope. The running development database's
Organization records were not seeded or changed. Real Keycloak authentication
may refresh the normal local development principal through existing OIDC
provisioning.

## Acceptance results

| Gate | Result and evidence |
| --- | --- |
| Clean migrations | PASS: `pytest --create-db` builds a new PostgreSQL test database, applies the migration graph, and verifies all ten seeded type codes. `check`, migration drift and pending migration checks also pass. |
| Root/colleges/departments | PASS: root, two colleges and two departments created via API; FK relationships and the single University root verified. |
| Research/directorate/administrative units | PASS: Research Center, Library and Registrar created with managed types as shown above. |
| Three-level hierarchy | PASS: tree, children, ancestors, descendants and subtree have the expected members/order; a department moves between colleges and back. |
| Invalid hierarchy | PASS: self-parenting, descendant-parenting and root movement are rejected without audit success records. Existing suite also tests simultaneous inverse moves at three PostgreSQL isolation levels. |
| CRUD/lifecycle API | PASS: create/list/retrieve/PATCH work. DELETE/PUT remain intentionally unsupported; retirement is deactivate then archive. Immutable normalized code uniqueness is verified through both HTTP and a failed PostgreSQL duplicate insert. |
| Concurrent/stale edits | PASS: changed detail ETag returned; stale PATCH receives 412 without overwriting the row. Existing suite verifies simultaneous conditional PATCH has one winner. |
| Discovery/pagination | PASS: combined name/code search, type/status/parent filtering and deterministic ordering; existing discovery suite verifies filtered pagination/ties, strict query validation, Unicode/literal escaping and database-backed slicing. |
| Lifecycle/history | PASS: active descendants block parent retirement; bottom-up deactivation and archival work; root remains ACTIVE; inactive children are not silently cascaded; archived units remain readable. |
| Future-reference integrity | PASS: a real FK consumer still references the archived college; API and raw SQL destructive deletion are rejected. Existing lifecycle tests validate active-Site veto hooks and Site-write/deactivation races using a test consumer. No production Site model is claimed. |
| Audit | PASS: representative workflow produces 8 CREATED, 1 UPDATED, 2 MOVED, 3 DEACTIVATED and 2 ARCHIVED events with actor, entity, correlation ID, peer IP and sanitized snapshots. Rejected/no-op operations do not invent successes. Existing tests inject audit-storage failure and verify rollback/sanitized 503. |
| Restricted writes | PASS: anonymous operations are 401; non-admin tokens are 403; authenticated writes are 403 with default opt-in disabled or DEBUG=False, even if opt-in is True. No superuser session bypass of bearer API authorization is introduced. |
| Documentation/schema | PASS: OpenAPI validates with DEBUG=False and warnings treated as failures; generated content equals the repository snapshot: 20 operations across 14 paths. API schema is also retrieved inside the representative workflow. |
| Startup/live identity | PASS: running Docker services healthy where health checks exist; a real Keycloak development user token passes backend issuer/audience/signature/role checks over Nginx for identity, Organization list/tree and combined discovery reads. Request IDs survive the route. |
| Backend foundation decision | PASS: no known open critical/high defect was identified in this validated scope. Site implementation may build on these model, service, selector, API and audit contracts. Production authorization and external acceptance evidence remain separate. |

The cross-feature workflow uses Django's HTTP test client, real PostgreSQL
and cryptographically signed test-provider JWTs. The separate live smoke
uses the running Keycloak, Nginx and backend for reads and denied writes.
Successful live write opt-in is exercised only in isolated tests; this
validation does not enable writes on the running backend. No frontend build,
formal penetration test or completed Site/RBAC implementation is claimed.

## Reproduction

Run from the repository root after the development stack is running:

```console
docker compose exec -T backend pytest --create-db -o addopts='' -q tests/test_organization_readiness.py
docker compose exec -T backend pytest --create-db -o addopts='' -q --junitxml=/tmp/organization-readiness-results.xml
docker compose exec -T backend python manage.py check
docker compose exec -T backend python manage.py makemigrations --check --dry-run
docker compose exec -T backend python manage.py migrate --check
docker compose exec -T -e DEBUG=False backend python manage.py spectacular --file /tmp/readiness-openapi.yaml --validate --fail-on-warn
```

`--create-db` refers to pytest's disposable `test_<DB_NAME>` database, not
the running application database. Do not run test databases concurrently
under the same name. The independent acceptance command passed **4 tests**
before the full run. Tests enable development writes only through per-test
settings and reset them afterward.

For the real development Keycloak/Nginx smoke in PowerShell:

```powershell
Get-Content -Raw scripts/validate-organization-keycloak.py |
  docker compose run --rm -T --no-deps --entrypoint python keycloak-init -
```

The existing service environment supplies development credentials; the
script does not print them or change realm configuration. It requires the
normal running-backend write opt-in to remain disabled. Observed results:

```text
Development Keycloak token exchange: 200 (credentials and token omitted)
Authenticated GET /api/me/: 200; correlation ID preserved
Authenticated GET /api/v1/organizations/: 200; correlation ID preserved
Authenticated GET /api/v1/organizations/tree/: 200; correlation ID preserved
Authenticated GET /api/v1/organizations/?search=informatics&type=COLLEGE&status=ACTIVE: 200; correlation ID preserved
Anonymous hierarchy access: 401
Invalid bearer access: 401
Authenticated write with normal development opt-in disabled: 403; no Organization created
```

Azure's existing backend job now writes JUnit and publishes backend/Organization
test results on success or failure, in addition to the existing validated
OpenAPI artifact/snapshot check. **Hosted execution is pending**; local results
do not imply the full hosted pipeline, image publication or merge succeeded.

## Defects and remaining integration work

No critical/high backend defect remains known from these checks. Two
validation/documentation issues were resolved: the test FK consumer uses a
rollback-scoped regular table because PostgreSQL forbids temporary-to-permanent
table FKs; current README/architecture descriptions now identify implemented
REST/audit features and the migration-role command correctly. Earlier
story-specific evidence remains historical rather than being overwritten.

Site implementation must complete these integration requirements:

1. Depend on the latest Organization/Audit migrations. Reference the approved
   OrganizationUnit identifier with a protected FK; retain historical links.
   Keep domains, homepages, themes/templates and other website configuration
   in Site-related domains.
2. Replace `organizations_has_active_sites(bigint[])` with the actual Site
   status/FK query. Do not leave the default absent-Sites stub active once
   Site records exist, including when using a nonstandard table name.
3. Acquire the common hierarchy serialization guard before Site/unit row
   locks on link/activation changes. Reject ACTIVE Sites linked to non-ACTIVE
   units and test races against Organization deactivation/archive. No silent
   Site status/delete cascade is permitted.
4. Implement scoped IAM/RBAC, membership-aware querysets and module activation
   checks before releasing scoped Site APIs or production Organization writes.
   Test cross-Site denial for list, lookup, create/update and linked objects.
   A caller-supplied organization/site header is never authorization.
5. Use the shared audit writer in the same transaction for significant Site
   operations, with a Site-specific snapshot allowlist. Preserve request/system
   context and fail closed on audit persistence failure.
6. Source actual institutional records/classifications from the authorized
   UoG registry owner. Keep the representative fixture test-only.

Keycloak integration works for the approved development administrator role.
**Scoped production RBAC, production identity-flow/security approval and
production-facing write authorization remain dependencies.** Backend readiness
does not remove the DEBUG=False write denial or add a temporary bypass.

Contracts: [REST](../api/organizations.md),
[hierarchy](../api/organization-hierarchy.md),
[discovery](../api/organization-discovery.md),
[audit](../api/organization-audit.md),
[lifecycle/Site hook](../architecture/organization-lifecycle-rules.md),
[OpenAPI](../api/openapi.yaml).
