# SITE-002: core Site implementation

Contract: [Site data model and lifecycle](../architecture/site-data-model.md).
The core model lives in `backend/apps/sites/models/site.py`, is exported as
`apps.sites.models.Site`, and is registered with Django admin.

```python
from apps.sites.models import Site
from apps.sites.services.lifecycle import activate_site, suspend_site, archive_site

site = Site.objects.create(
    organization_unit=college,
    code="INFORMATICS",
    name="Informatics Website",
    short_name="CoI",
    default_language="en-us",
    configuration={},
)  # DRAFT; college must be ACTIVE
activate_site(site.pk)
suspend_site(site.pk)  # Row/configuration/history retained.
activate_site(site.pk)  # Revalidates the owning unit.
archive_site(site.pk)  # Terminal, with historical references retained.
```

The main university website uses an explicit `is_main=True` designation and
must reference the UNIVERSITY root. Other organizations do not need a Site;
several differently coded properties may reference one unit. Globally unique
Site codes are normalized/immutable. IDs use the existing BigAutoField
strategy. Configuration is the versioned allowlist in
[site configuration](../architecture/site-configuration.md); no institutional
hierarchy data is duplicated into Site.

The nullable template FK was intentionally absent from `sites.0001_initial`.
SITE-006 adds it in `sites.0004_sitetemplate`; see
[site templates](../architecture/site-template.md). Administration is
documented in the [Site API contract](../api/sites.md). Persistence does not
grant a public write bypass or production scoped RBAC.

Apply `sites.0001_initial` using the project's migration-role entrypoint. It
installs the real active-Site Organization hook in the **same atomic migration**
as the Site table. Existing Organization retirement rules now inspect actual
ACTIVE Sites. Site writes reuse the common transaction guard; audit storage,
identifier, request and permission infrastructure are reused as documented
without creating an Organization-specific or duplicated institution model.

```console
docker compose exec backend /app/entrypoint.sh python manage.py check
docker compose exec -T backend pytest -o addopts='' -q apps/sites/tests
docker compose exec -T backend pytest --create-db -o addopts='' -q
docker compose exec -T backend python manage.py makemigrations --check --dry-run
docker compose exec -T backend python manage.py migrate --check
```

Tests cover fields/defaults, global uniqueness and a failed SQL duplicate,
required owner/name, language/configuration validation, invalid bulk inserts,
main-root ownership/uniqueness, lifecycle transitions, retained suspended/
archived state, deletion/rekey rejection, actual active-Site retirement veto,
and concurrent activation/reassignment versus Organization deactivation.
Migration rollback tests exercise the dependent graph and restore real hooks.

Story commit/merged PR and hosted CI result remain pending until user review,
push and merge. Local validation does not claim those external results.

## Completion evidence (2026-10-24)

| Evidence | Result |
| --- | --- |
| Migration | `sites.0001_initial` applied successfully in Docker using the migration role. It creates the Site table and lifecycle/hook integration atomically and depends on `organizations.0006_audit_events`; no missing SiteTemplate reference exists. |
| Site model suite | **50 passed in 12.11s**, including the seven prior module checks and persistence, SQL integrity, lifecycle, main-root and real Site/Organization concurrency cases. |
| Complete clean PostgreSQL suite | **367 passed in 93.53s** (`pytest --create-db -o addopts='' -q --junitxml=/tmp/site-entity-results.xml`); [JUnit output](evidence/site-entity.junit.xml). Earlier Organization, authentication, audit and API/schema cases pass. |
| Checks | `manage.py check`, `makemigrations --check --dry-run`, `migrate --check`: exit 0; no pending model/schema changes. |
| Template sequencing | `sites.0001_initial` deferred the FK. `sites.0004_sitetemplate` now adds SiteTemplate and the nullable Site reference. |
| Organization integration | Actual ACTIVE Site rows veto owner retirement; suspension releases the veto; active Site activation/reassignment cannot race into an inactive owner. Historical owner references survive Site/Organization archival. |
| OpenAPI | `spectacular --validate --fail-on-warn` with DEBUG=False: exit 0; repository snapshot matches generated schema. Sites tag now describes core persistence/lifecycle. No REST operations added; schema remains 20 operations across 14 paths. |
| Running backend | Liveness/readiness return 200; Site API prefix remains 404; anonymous Organization API remains 401. |
| Regression / source | No regression detected locally. Work remains uncommitted on `P1-SITE-001-to-P1-SITE-010`; the user's existing staged `.gitignore` edit was untouched. No commit/push performed; merged Site PR/commit and hosted CI results remain pending. |
