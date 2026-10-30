# Menu model audit — 2026-10-31

Historical model-foundation evidence. The subsequent [Menu API story](menu-api.md)
adds HTTP administration, Menu-wide versions and durable change auditing.

Story scope: Site-owned, location-aware, ordered menu trees. The model foundation
has no new Menu HTTP endpoint; public menu delivery and editing APIs are separate
stories. Existing APIs keep their permission checks.

## Remediations

- Verified `0008_menu_menuitem` now exists; added reversible `0009_menu_integrity`.
- Added a Menu active flag and controlled location keys shared with a DB constraint.
- Validate moved subtrees, not only the moved item's ancestry.
- Serialize mutations and enforce tree, ownership, target and module rules in
  PostgreSQL for raw SQL, bulk writes and concurrent transactions.
- Block destructive writes while MENUS is disabled; keep historical rows.
- Reject malformed URLs, encoded controls, credentialed authorities and unsafe
  schemes; handle parser errors as validation failures.
- Add actor-authorized domain services and a bounded ordered tree selector.
  Cross-Site links require explicit opt-in and target-Site content-view access.
- Add the CMS test directory to default pytest/CI discovery.
- Describe the implemented domain boundary accurately in the OpenAPI Menus tag.
- Fix the module-management gate's undefined `using` variable and let authorized
  administrators enable/re-enable or disable a module. Content writes still
  require effective module availability at both domain and database levels.
- Give older CMS API test administrators explicit database role assignments,
  matching the existing security policy; token claims alone never grant them.
- Reject invalid pre-existing ownership, targets or trees during the integrity
  migration, while allowing valid data to be upgraded with the module disabled.

## Validation

Tests run against a disposable PostgreSQL test database, using the backend
dependencies plus the declared `nh3==0.3.7` sanitizer in an isolated container.
Repository docs are copied into the container for the documentation assertions.
No migrations were applied to the local application database during this audit.

- Focused Menu/module suite: **50 passed**. Includes simultaneous inverse moves
  over two independent PostgreSQL connections, raw/bulk integrity failures,
  authorization, module API switches and migration downgrade/upgrade checks.
- Rechecks of existing Site/module, Swagger, CMS workflow/revision and block
  behavior: **77 passed** before the additional migration/API regressions.
- `manage.py check`: passes.
- `manage.py makemigrations --check --dry-run`: no changes detected.
- `manage.py spectacular --validate --fail-on-warn`: passes without warnings.
- Generated schema matches `docs/api/openapi.yaml` semantically: **57 paths**.
  The refreshed snapshot also documents existing IAM routes previously missing
  from that file; it does not invent Menu HTTP routes.
- Full default pytest regression: **582 passed in 198.31 seconds**. Clean test
  database migrations, existing Organization/Site/IAM/CMS behavior and the newly
  included CMS suite all pass. No unresolved critical/high defect was found in
  the audited Menu model scope.

Reproduce after installing `backend/requirements/dev.txt`, configuring the
documented PostgreSQL test role and running from `backend`:

```sh
pytest -o addopts= -q apps/cms/tests/test_menus.py apps/cms/tests/test_menu_integrity.py apps/cms/tests/test_module.py
pytest -o addopts= -q --junitxml=backend-test-results.xml
python manage.py makemigrations --check --dry-run
python manage.py spectacular --file openapi.yaml --validate --fail-on-warn
```

Evidence: [focused JUnit](evidence/menu-audit-focused.junit.xml),
[full regression JUnit](evidence/menu-audit-regression.junit.xml).

## Completion evidence

Local changes remain uncommitted for review. No commit or push is authorized.
Merged PR, remote CI result and Azure DevOps Issue attachment are pending the
repository owner's review and publication. No Issue id or linked PR was supplied;
this report must not be treated as an external approval or a CI success claim.
