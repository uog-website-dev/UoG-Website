# Module registry

Implementation date: 2026-10-27. `Module` is the platform catalog of
capabilities. Sites do not invent module names. CMS, Media, Staff directory,
Academics, News and announcements, Events, Job notice board, Search and
Analytics are seeded registry rows. This story does not implement those
capabilities.

## Fields

| Field | Contract |
| --- | --- |
| code | Globally unique uppercase code, immutable after creation |
| name | Required human-readable name |
| description | Required description |
| status | `PLANNED`, `IMPLEMENTED` or `DEPRECATED`. New rows start `PLANNED`. The seeded catalog stays `PLANNED`. |
| is_enabled | Global switch, default false. It can be true only when status is `IMPLEMENTED`. |
| configuration_schema | Version 1 allowlist: `schema_version` and `properties`. Each property has `code`, `label`, `type` (`boolean`, `string` or `integer`) and `required`. Empty until a schema is approved. Secrets are rejected. |
| created_at / updated_at | Timezone-aware automatic timestamps |

`PLANNED` may become `IMPLEMENTED` or `DEPRECATED`. `IMPLEMENTED` may become
`DEPRECATED`. `DEPRECATED` may return to `IMPLEMENTED`. A module cannot return
to `PLANNED`. Codes and rows are not deleted.

## What is usable

A module is usable only when all three are true:

- status is `IMPLEMENTED`
- `is_enabled` is true
- `sites_module_implementation` contains its code

That table starts empty. The runtime database role cannot insert into it.
A later deployment records a code there in the same change that ships the
feature. Until then, a registry row is not advertised by `usable_modules()`
and cannot be enabled for a Site. Setting a planned code to `IMPLEMENTED`,
in the model or through a direct update, is rejected.

Per-site enablement, settings and the availability check are specified in
[site modules](site-module.md). A planned module still cannot be enabled for
a Site. Approved schema documents do not by themselves make a module usable.

Provisioning a Site does not enable modules. The registry is administered at
`/api/v1/modules/`. See the [Site API contract](../api/sites.md).
