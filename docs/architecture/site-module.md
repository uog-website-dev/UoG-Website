# Site modules

Implementation date: 2026-10-27. A SiteModule row links one Site to one
registry Module. Different Sites keep different enablement and settings.
Turning a module on for one Site is a saved row, not a code change, a new
application, a new database or a new deployment.

The module must already be implemented, recorded in
`sites_module_implementation`, and globally enabled. The seeded capabilities
stay planned until a deployment ships them. After that, each Site can enable
or disable that module on its own.

## Fields

| Field | Contract |
| --- | --- |
| site | Required protected FK. The pair cannot be moved to another Site. |
| module | Required protected FK to the registry. Sites do not store a free-text module name. |
| is_enabled | Site switch. A new row is created by enabling the module. |
| configuration | Settings validated against that module's approved `configuration_schema`. `{}` when the schema has no properties. |
| created_at / updated_at | Timezone-aware timestamps |

The Site and Module pair is unique. A second row is rejected. Enabling an
existing row again updates that row.

## Availability

`enabled_modules_for_site` returns modules that are implemented, globally
enabled, and enabled on that Site. `available_module_codes` loads those codes
in one query. Site resolution stores them on `request.enabled_module_codes`.
Backend code checks `module_available_on_request`. A registry row, a schema,
or a display flag is not enough.

A globally disabled module cannot be newly enabled and cannot be turned back
on. The check applies to model saves and to direct updates.

## Disabling

`disable_module_for_site` sets `is_enabled` false. The row and its
configuration remain. The assignment cannot be deleted, so turning a module
off does not remove the settings stored for that Site. Later module business
data must use this row, or the Site, rather than being removed by the switch.
Availability checks stop returning the module while it is off. Another Site's
row is unchanged.

Per-site enablement is managed at `/api/v1/sites/{site_pk}/modules/`. See the [Site API contract](../api/sites.md).
