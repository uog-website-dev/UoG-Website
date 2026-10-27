# Multi-site foundation gate

Validation date: **2026-10-27**. The same Django process and database serve
four representative websites from Organization, Site, template, configuration
and domain rows. No hostname is selected by application code.

This gate does not authorize production administration writes, mark the seeded
CMS, events, or other registry rows as implemented, or replace scoped
IAM/RBAC. Hosted CI and a merged commit were not run for this working tree.

## What was demonstrated

The acceptance test creates the existing University of Gondar hierarchy
through the Organization API, then for each website:

1. creates a Site from an active template;
2. merges that Site's own configuration;
3. assigns and designates its primary domain;
4. proves the hostname does not resolve while the Site is still draft;
5. enables only the modules listed for that Site;
6. activates the Site;
7. reads `GET /api/v1/site-context/` with that `Host`.

| Organization | Site | Template | Hostname | Enabled modules in the test |
| --- | --- | --- | --- | --- |
| UOG, university root | Main Site | UNIVERSITY_MAIN | `www.uog.local` | STAFF_DIRECTORY |
| CI, College of Informatics | Informatics Site | COLLEGE | `informatics.uog.local` | EVENTS |
| CM, College of Medicine | Medicine Site | COLLEGE | `medicine.uog.local` | EVENTS, STAFF_DIRECTORY |
| RC, Research Center | Research Center Site | RESEARCH_CENTER | `research.uog.local` | none |

Informatics and Medicine share the college template and keep different
configuration after that template is edited. A client `X-Forwarded-Host`
does not change the Site selected from `Host`. `unknown.uog.local` and a
suspended Medicine site return 404. Informatics, the main site, and a site
added later still resolve. A domain or module id read under another Site
returns 404. Enabling the still-planned CMS module returns 400.

The test then creates School of Law and `law.uog.local` from the general
template, with Events enabled, and checks that the migration set is
unchanged. Disk and applied Site migrations remain `0001` through
`0006_sitemodule_settings`. No new schema migration is part of this gate.

Module enablement uses the existing registry gate. The test records
`EVENTS` and `STAFF_DIRECTORY` as shipped only inside the test transaction,
then marks those registered rows implemented and globally enabled through
the API. The development database was not given that shipment, so its four
Sites stay active with independent configuration and **no** enabled modules.
Planned capabilities are still not usable.

## Running development data

The four Sites above were created on the local development database, attached
to the existing active UOG, CI, CM and RC units. `GET /api/v1/site-context/`
on backend port 8000 returned each Site for its hostname, `site: null` for
`localhost`, 404 for an unknown host, and the Informatics site when
`X-Forwarded-Host` named Medicine.

The development ingress still accepts only `localhost` and `127.0.0.1`.
A request to nginx with `Host: www.uog.local` is closed before Django.
Django admits a resolved Site host for that request only. `ALLOWED_HOSTS`
is unchanged.

Representative hostnames live in
[uog-foundation.json](../../backend/apps/sites/fixtures/uog-foundation.json).
Application Python does not contain `uog.local` or `uog.edu.et`.

## Evidence

- Full PostgreSQL suite: **421 passed in 84.02s**
  (`pytest --create-db -o addopts='' -q`). Includes the previous 419 tests
  and two foundation cases. [JUnit](evidence/site-foundation.junit.xml).
- Acceptance test:
  [test_site_foundation.py](../../backend/tests/test_site_foundation.py).
- Public resolution read: `GET /api/v1/site-context/`, documented in the
  [Site API contract](../api/sites.md) and [OpenAPI snapshot](../api/openapi.yaml).
- `manage.py check` and `makemigrations --check` were already clean for the
  Site models. This gate adds no migration.
- Hosted CI was not run. This work is not committed.
