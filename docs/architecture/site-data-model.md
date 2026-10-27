# Core Site model and lifecycle choices (SITE-002)

Implementation date: 2026-10-24. The repository provides the existing Django
architecture and Organization/Audit contracts but no additional P0 Site ERD
or lifecycle decision. These documented choices implement this story's
explicit relationship gate; they do not claim an unavailable P0 sign-off.

## Fields and relationship

| Field | Contract |
| --- | --- |
| id | Existing project BigAutoField identifier strategy |
| organization_unit | Required FK to `organizations.OrganizationUnit`, ORM PROTECT and real PostgreSQL FK, related name `sites` |
| code | Global unique uppercase ASCII machine code, 64 characters; trim/uppercase on model writes, immutable after creation |
| name | Required nonblank name, 255 characters |
| short_name | Optional, 100 characters |
| default_language | Required normalized lowercase language-code string, 35 characters, default `en-us` matching current platform default |
| status | DRAFT, ACTIVE, SUSPENDED or ARCHIVED; new records start DRAFT |
| configuration | Versioned allowlisted JSON document, schema version 1. See [site configuration](site-configuration.md). |
| template | Nullable FK to SiteTemplate, added in `sites.0004_sitetemplate`. Provenance of the copied defaults. See [site templates](site-template.md). |
| is_main | Explicit main-university property designation; defaults False |
| created_at / updated_at | Timezone-aware automatic timestamps; updates include updated_at |

An OrganizationUnit may have no Site, or several distinct digital properties.
There is no owner uniqueness constraint. No institutional type, parent/tree,
organization names or other OrganizationUnit behavior is copied into Site.
The FK references the existing model lazily; the only direct Organization
Python dependency is its public `hierarchy_write` serialization boundary.
Organizations does not import Site models or selectors.

`is_main` makes the main-site rule enforceable without inventing a reserved
code or guessing from a name. A main Site must reference the single UNIVERSITY
root. At most one **non-ARCHIVED** main property is permitted; archived main
designations remain historical, allowing a differently coded replacement.
The rule is enforced both by domain validation and SQL triggers/partial unique
constraint. Ordinary root-owned properties need not be marked main.

The globally unique code is independent of the owning unit. PostgreSQL
canonical-format and unique constraints prevent case/whitespace variants
from bypassing uniqueness; raw/bulk callers must supply canonical values.
The FK index and unique-code index serve owner lookups, the active-Site hook
and exact property identity. No speculative name/status search indexes or
external search engine are introduced in this model story.

Language codes normalize by trimming/lowercasing, with a 2–3 letter primary
subtag and optional 2–8 character alphanumeric subtags (`en`, `am`, `en-us`,
`zh-hant`). This is a deliberately constrained storage format, not a complete
BCP-47 parser or a claim that every syntactically valid code has translated
content. No approved content-language catalog was supplied, so no invented
fixed English/Amharic enum or language-specific columns are added. Catalog
activation and localized content behavior belong to the multilingual stories.

## Template sequencing

`sites.0001_initial` does not create a template table or a placeholder FK.
`sites.0004_sitetemplate` creates SiteTemplate and adds the nullable
`Site.template` reference. Application rules are in
[site templates](site-template.md).

## Lifecycle and retained history

| Current state | Permitted different next states |
| --- | --- |
| New record | DRAFT only |
| DRAFT | ACTIVE, ARCHIVED |
| ACTIVE | SUSPENDED, ARCHIVED |
| SUSPENDED | ACTIVE, ARCHIVED |
| ARCHIVED | None |

Same-state saves are allowed. Draft archival supports abandoning an
unpublished property; suspended archival avoids briefly reactivating a site
just to retire it. Backward transitions to DRAFT and unarchiving are denied.
Suspension and archival retain the row, PK, configuration and owner link;
there is no deletion, content cascade or Organization status change.
Destructive deletion is disabled in the model/admin and by a database trigger.
Codes and IDs are immutable. Archived ownership and main designation are
frozen; presentation/configuration corrections remain possible.

New/reassigned ownership requires an ACTIVE OrganizationUnit. ACTIVE Sites
always require ACTIVE owners (whose ancestors must already be ACTIVE under
Organization rules). A historical draft/suspended/archived Site may retain
an owner that is later deactivated/archived, but cannot activate under it.
Suspension releases the active-Site retirement veto; reactivation must
revalidate the owner's committed state. No silent cascade occurs.

## Database enforcement and concurrency

`sites.0001_initial` depends on `organizations.0006_audit_events` and atomically
creates the table, constraints, lifecycle validator, Site statement/row
triggers and the real `organizations_has_active_sites(bigint[])` query.
There is no deployment window with a committed Site table and an unwired
absent-Sites hook. Frozen SQL is in `apps/sites/migration_sql.py`; future rule
changes require new migrations, not editing that initial SQL.

All Site INSERT/UPDATE/DELETE statements acquire the same transactional
Organization hierarchy guard. Normal saves, internal lifecycle services and
bulk ORM mutations acquire it before validation/row locks; raw SQL is covered
by statement and row triggers. The active-Site hook queries the real Site
table by owner IDs and ACTIVE status, so Organization retirement protects
entire subtrees. Concurrent Site activation/active reassignment versus owner
deactivation has one successful writer and one rejected writer; impossible
ACTIVE-Site/inactive-owner states cannot both commit.

`sites.validation` adapts recognized SQL rule failures to field-specific
Django ValidationError without poisoning outer transactions. FK, unique,
language/name/status and JSON-object checks also exist at database level.
The migration reverses triggers/functions before dropping the table and
restores the Organization fail-closed absent-Sites hook. Do not downgrade
this schema with real Site data unless a separate data-retention plan exists.

Organization migration tests now restore all graph leaves, including dependent
Site migrations. Legacy absent-Sites tests explicitly install the historical
stub when testing its failure mode; test-consumer hooks restore the function
that was present before each test rather than overwriting real integration.

## Scope and infrastructure

Internal services provide `activate_site`, `suspend_site`, `archive_site` and
`transition_site`; caller authorization remains required. Django admin uses
normal staff/model permissions and has no destructive delete action.
Administration is the restricted API in the [Site contract](../api/sites.md).
This data model does not itself grant public writes or scoped RBAC. Template
behavior is specified in [site templates](site-template.md). Site-specific
audit event mapping is not introduced here; the shared audit context is
available through the common guard for the later Site audit story.
Organization auditing remains enforced.
