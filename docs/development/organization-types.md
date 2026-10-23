# Organization type implementation

This document records the classification story's scope and verification.
OrganizationUnit has since been implemented; see
[unit implementation and evidence](organization-units.md) for its actual
protected type relation and migration.

[DEC-04](../architecture/decisions/DEC-04-organization-types.md) records the
project owner's managed-lookup decision on 2026-10-23. The implementation is
isolated under `backend/apps/organizations`; no College, Department or
OrganizationUnit tables or new REST operations are introduced.

## Using the lookup

```python
from apps.organizations.models import OrganizationType

college_type = OrganizationType.objects.get(code="COLLEGE")
print(college_type.code)          # stable identifier
print(college_type.display_name)  # presentation label in the active locale
```

The ten required UoG types are inserted by a data migration, not by
application startup or runtime API calls. Valid configured records beyond
those seeds are supported. Codes use uppercase ASCII letters, digits and
underscores, beginning with a letter, at most 64 characters. Names are
required, at most 255 characters, editable, and need not be unique.

Administrators with the relevant Django model permissions can add types
and edit names at `/django-admin/organizations/organizationtype/` through
Nginx (or `/admin/organizations/organizationtype/` on the direct backend).
Code is read-only after creation. Bulk updates and SQL cannot bypass
uniqueness, code-format checks, nonblank-name checks or code immutability.
There is no automatic mapping from an unknown code to OTHER.

Use a foreign key with `on_delete=models.PROTECT` from OrganizationUnit
when that model is implemented; see DEC-04 for the field declaration.
The integration test uses a temporary consumer table to verify model and
queryset deletion protection and database referential integrity without
adding a speculative production unit model. The lookup itself can be
deleted if no record references it.

The database `name` is a default display label, not a localized code.
Seed labels are marked using `gettext_noop` for catalogue extraction;
`display_name` applies Django translation on presentation. No translations
or language-specific columns are fabricated. Custom labels without a
catalogue entry display as entered.

## Migrations and verification

- `organizations.0001_initial`: lookup model, unique/check constraints and
  PostgreSQL trigger preventing code changes. The trigger is reversible.
- `organizations.0002_seed_organization_types`: ten initial records;
  idempotent if its seed function is rerun, preserving existing labels.
  Reversing only this seed migration retains the rows to avoid removing
  edited or referenced data.

Apply migrations through the existing backend entrypoint so schema changes
use `DB_MIGRATE_USER`, while web requests keep using the application role:

```console
docker compose exec backend /app/entrypoint.sh python manage.py check
docker compose exec backend pytest
docker compose exec backend python manage.py makemigrations --check --dry-run
docker compose exec backend python manage.py spectacular --file /tmp/openapi.yaml --validate --fail-on-warn
```

The foundation tests now expect the lookup and its two migrations, while
continuing to check application registration, imports, domain isolation,
existing application migrations, health and existing routes. The empty
organization API namespace remains reserved. OpenAPI has no additional
operations for this model-only story.

## Story completion evidence (2026-10-23)

| Evidence | Result |
| --- | --- |
| Decision | DEC-04 accepted: managed lookup, immutable codes, protected references. |
| Model/admin | `models/organization_type.py`, exported as `apps.organizations.models.OrganizationType`; `admin/organization_type.py`. |
| Migrations | `organizations.0001_initial` and `organizations.0002_seed_organization_types` both applied successfully in the Docker development database as `uog_migrate`. |
| Organization tests | `pytest apps/organizations/tests`: **36 passed in 4.72s**. |
| Full backend suite | `pytest`: **91 passed in 14.49s**, including existing platform, authentication, documentation and domain-boundary checks. |
| Model/migration consistency | `makemigrations --check --dry-run`: **No changes detected**; `migrate --check`: exit 0. |
| Application startup | Django system check: **no issues**. Live liveness, readiness and Swagger URLs: **HTTP 200**. |
| Seed availability | Runtime `uog_app` role successfully reads all ten required codes. |
| API/schema | No REST operations added; existing OpenAPI generation with `--validate --fail-on-warn` passes, exit 0. |
| CI | Existing Azure backend pytest step discovers the new tests automatically; hosted CI result **pending**, not verified here. |
| Merged PR/commit | **Pending**; changes remain in the working tree. Attach the merged story reference before closure. |

No regression was detected against earlier stories by the complete backend
suite and live health/documentation checks. The OrganizationUnit relation
is specified and tested with a temporary consumer; the production
OrganizationUnit model remains a subsequent story.
