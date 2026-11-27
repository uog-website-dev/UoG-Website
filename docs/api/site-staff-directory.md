# Site Staff Directory API

Staff Directory settings are mounted under `/api/v1/sites/{id}/staff-directory-settings/`. Requests require Keycloak bearer authentication, Site-scoped `sites.update`, and an enabled `STAFF_DIRECTORY` module for that Site. Disabling the module blocks reads and writes without deleting retained `SiteStaffDirectorySettings` rows or future Staff profiles.

## Settings

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/sites/{id}/staff-directory-settings/` | Returns defaults when no row exists. Strong ETag. Includes server-resolved Organization `scope`. |
| PATCH | `/api/v1/sites/{id}/staff-directory-settings/` | Requires `If-Match`. Validates page size (5–100), default sort, public list path, presentation, and aggregation eligibility. |

Validated settings fields:

- `page_size` (default `20`)
- `default_sort` (`NAME_ASC`, `NAME_DESC`, `TITLE_ASC`, `DEPARTMENT_ASC`)
- `public_list_path` (default `/staff`; lowercase same-site path)
- `presentation` (`LIST` or `CARDS`)
- `public_aggregation_eligible` (default `false`)

`aggregation_write_access` is always `false`. Setting `public_aggregation_eligible` only marks the Site for University Main public listing; it never authorizes modification of another Site's directory records. Ownership (`site`) and `version` are server-managed and rejected when supplied by the client.

## Organization scope

Scope is resolved exclusively from the authenticated Site record and Organization hierarchy. Client-supplied Site or Organization identifiers are never treated as authority.

- College / child Sites: `mode=mapped_organization` with the mapped Organization and its descendants.
- University Main (`is_main`): may use `mode=main_with_eligible_aggregation` when other Sites have `public_aggregation_eligible=true` and an enabled `STAFF_DIRECTORY` module. Otherwise Main also uses mapped organization scope.

## Public context

When `STAFF_DIRECTORY` is available for the host-resolved Site, `/api/v1/site-context/` includes `configuration.staff_directory` with the public settings subset and lists `STAFF_DIRECTORY` in `modules`. Otherwise Staff Directory settings are omitted and public navigation/endpoints that depend on the module remain hidden. Disabling the module does not delete settings or profiles.

## Administration UI

Authorized Site Admins see Staff Directory navigation (All Staff, Add New, Directory Settings) only when `STAFF_DIRECTORY` is enabled for that Site. Module enable/disable remains the existing central Site module registry flow.

## Migration / rollback

Migration `sites.0024_staff_directory_module` creates `SiteStaffDirectorySettings`, installs PostgreSQL guard/audit triggers, and ships `STAFF_DIRECTORY` as `IMPLEMENTED`. Rolling back the migration returns the module to `PLANNED`, removes the implementation marker, and drops the settings table and triggers. Existing Site module enablement rows for `STAFF_DIRECTORY` should be reviewed before rollback in shared environments.
