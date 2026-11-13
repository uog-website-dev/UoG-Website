# Module registry

Implementation date: 2026-10-27 (content codes added 2026-10-29 by
P2-CMS-001; PAGES shipped by P2-CMS-006; VISUAL_BUILDER shipped 2026-11-12).
`Module` is the platform catalog of capabilities. Sites do not invent module
names. Pages, Media, Staff directory, Academics, News and announcements,
Events, Job notice board, Search and Analytics are registry rows. POSTS,
MENUS and VISUAL_BUILDER are implemented; platform operators enable their
global switches, then Site administrators enable them per Site.
VISUAL_BUILDER requires PAGES on the same Site and drives the Visual Builder
admin menu.

## Fields

| Field | Contract |
| --- | --- |
| code | Globally unique uppercase code, immutable after creation |
| name | Required human-readable name |
| description | Required description |
| status | `PLANNED`, `IMPLEMENTED` or `DEPRECATED`. New rows start `PLANNED`; PAGES is implemented by P2-CMS-006. |
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

The table starts empty; the runtime database role cannot insert into it.
The P2-CMS-006 migration records PAGES as shipped and marks its registry row
IMPLEMENTED. Its global switch remains off by default. A platform
administrator enables the global switch, then a Site administrator enables
PAGES for an individual Site. Public delivery checks all three conditions
for every request. Other planned capability codes remain unavailable.

Per-site enablement, settings and the availability check are specified in
[site modules](site-module.md). A planned module still cannot be enabled for
a Site. Approved schema documents do not by themselves make a module usable.

Provisioning a Site does not enable modules. The registry is administered at
`/api/v1/modules/`. See the [Site API contract](../api/sites.md).

## Platform availability control

In Module management → Registry, the Platform availability switch reads the
stored `is_enabled` value, including modules disabled by default such as MEDIA.
Only shipped, IMPLEMENTED modules can be switched on. Each change requires
confirmation and `platform.sites.manage_registry`; changing `is_enabled` alone
is permitted in production. Other registry edits retain the development gate.
The server action verifies the displayed row version, then PATCHes with its
strong ETag. A concurrent change returns 412 without overwriting it. Successful
changes use the existing transaction and audit triggers and refresh the registry
and Site activation summaries.

Turning a module off makes it unavailable across Sites while preserving Site
assignments, configuration and content. Turning it back on restores effective
availability for existing enabled assignments; it creates no new assignments.
Database defaults are unchanged by this control.
